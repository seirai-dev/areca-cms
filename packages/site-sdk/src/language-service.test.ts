import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/*
 * Real editor behaviour: a TypeScript language service over the package
 * sources plus one virtual app file. The app file marks the cursor with `|`.
 */

const srcDir = dirname(fileURLToPath(import.meta.url))
const packageDir = join(srcDir, '..')
const appFileName = join(srcDir, '__language-service-app__.ts')
const TIMEOUT = 60_000

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  verbatimModuleSyntax: true,
  types: ['node'],
}

/** Every non-test source file of the package, read from disk. */
function sdkSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sdkSourceFiles(path)
    const isSource = entry.name.endsWith('.ts') && !/\.test(-d)?\.ts$/.test(entry.name)
    return isSource ? [path] : []
  })
}

const sdkFiles = sdkSourceFiles(srcDir)

function createService(appSource: string): ts.LanguageService {
  const readSource = (fileName: string): string | undefined => {
    if (fileName === appFileName) return appSource
    return existsSync(fileName) ? readFileSync(fileName, 'utf8') : undefined
  }
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [...sdkFiles, appFileName],
    getScriptVersion: () => '1',
    getScriptSnapshot: (fileName) => {
      const text = readSource(fileName)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => packageDir,
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (fileName) => fileName === appFileName || existsSync(fileName),
    readFile: (fileName) => readSource(fileName),
    directoryExists: (dir) => existsSync(dir),
    getDirectories: (dir) => ts.sys.getDirectories(dir),
    realpath: (path) => ts.sys.realpath?.(path) ?? path,
  }
  return ts.createLanguageService(host, ts.createDocumentRegistry())
}

/** Strips the single `|` cursor marker and returns the offset it stood at. */
function withCursor(source: string): { source: string; offset: number } {
  const offset = source.indexOf('|')
  if (offset === -1 || source.indexOf('|', offset + 1) !== -1) {
    throw new Error('Mark exactly one cursor with |')
  }
  return { source: source.slice(0, offset) + source.slice(offset + 1), offset }
}

function completionNames(appBody: string): string[] {
  const { source, offset } = withCursor(header + appBody)
  const info = createService(source).getCompletionsAtPosition(appFileName, offset, undefined)
  return (info?.entries ?? []).map((entry) => entry.name).sort()
}

function hoverText(appBody: string): string {
  const { source, offset } = withCursor(header + appBody)
  const info = createService(source).getQuickInfoAtPosition(appFileName, offset)
  if (!info) return ''
  return [ts.displayPartsToString(info.displayParts), ts.displayPartsToString(info.documentation)].join('\n')
}

const header = `import { createContent } from './content.js'
import { defineSiteContent, type DraftEntry } from './index.js'
import { schema } from './test-fixtures/schema.js'
`

const contentSetup = `const content = createContent({ schema, dir: 'out' })
`

describe('completions on the content object', () => {
  it('lists collections and helpers after content.', () => {
    const names = completionNames(`${contentSetup}content.|`)
    expect(names).toEqual(expect.arrayContaining(['blogPosts', 'authors', 'pages', 'resolve', 'href', 'preview']))
  }, TIMEOUT)

  it('lists field keys inside where', () => {
    const names = completionNames(`${contentSetup}content.blogPosts.all({ where: { | } })`)
    expect(names).toEqual(expect.arrayContaining(['title', 'category']))
  }, TIMEOUT)

  it('lists the select options inside a where string', () => {
    const names = completionNames(`${contentSetup}content.blogPosts.all({ where: { category: '|' } })`)
    expect(names).toEqual(expect.arrayContaining(['news', 'guides']))
  }, TIMEOUT)

  it('lists only reference fields inside with', () => {
    const names = completionNames(`${contentSetup}content.blogPosts.all({ with: { | } })`)
    expect(names).toEqual(['author', 'editor'])
  }, TIMEOUT)
})

describe('completions in defineSiteContent', () => {
  it('lists collection keys for a reference collection', () => {
    const names = completionNames(`defineSiteContent({
  siteKey: 's',
  collections: {
    a: { route: '/$slug', fields: [] },
    b: {
      route: '/b/$slug',
      fields: [{ key: 'r', label: 'R', type: 'reference', collection: '|' }],
    },
  },
})
`)
    expect(names).toEqual(['a', 'b'])
  }, TIMEOUT)
})

describe('hover on entry data', () => {
  it('shows the JSDoc of the generated schema field', () => {
    const text = hoverText(`${contentSetup}const post = content.blogPosts.first()!
post.data.ti|tle
`)
    expect(text).toContain('Shown as the page heading')
  }, TIMEOUT)

  it('shows the JSDoc of the generated schema field on a draft entry', () => {
    const text = hoverText(`declare const draft: DraftEntry<'blogPosts', typeof schema>
draft.data.ti|tle
`)
    expect(text).toContain('Shown as the page heading')
  }, TIMEOUT)
})
