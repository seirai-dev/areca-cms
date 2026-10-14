import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { generateContentTypes } from './generate-types.js'
import type { Snapshot } from './types.js'

/*
 * Generates areca.gen.ts from a publication snapshot, compiles an app against
 * it with the real SDK sources, and expects zero diagnostics. Proves the
 * Register augmentation in the generated file types the ready `content`.
 */

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const sdkSrc = join(packageDir, 'src')

/** Raw CMS keys, as a publication snapshot carries them. */
const rawSchema: NonNullable<Snapshot['schema']> = {
  'blog-posts': {
    route: '/blog/$slug',
    label: 'Blog posts',
    fields: [
      { key: 'slug', label: 'Slug', type: 'slug', required: true },
      {
        key: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        description: 'Shown as the page heading.',
      },
      { key: 'cover-image', label: 'Cover image', type: 'image' },
      { key: 'category', label: 'Category', type: 'select', options: ['news', 'guides'] },
      { key: 'author', label: 'Author', type: 'reference', collection: 'authors' },
      { key: 'editor', label: 'Editor', type: 'reference', required: true, collection: 'authors' },
      { key: 'featured', label: 'Featured', type: 'boolean', required: true },
      { key: 'published-on', label: 'Published on', type: 'date' },
      { key: 'body', label: 'Body', type: 'richtext', required: true },
    ],
  },
  authors: {
    route: '/authors/$slug',
    label: 'Authors',
    fields: [
      { key: 'slug', label: 'Slug', type: 'slug', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
    ],
  },
}

const snapshot: Snapshot = {
  publicationId: 'pub-1',
  siteKey: 'acme',
  createdAt: '2026-10-01T00:00:00.000Z',
  hash: 'abc123',
  collections: {
    'blog-posts': [
      {
        id: 'post-1',
        slug: 'hello',
        publishedAt: '2026-10-01T00:00:00.000Z',
        data: {
          slug: 'hello',
          title: 'Hello',
          'cover-image': null,
          category: 'news',
          author: { collection: 'authors', slug: 'ada', id: 'author-1' },
          editor: { collection: 'authors', slug: 'ada', id: 'author-1' },
          featured: true,
          'published-on': '2026-10-01',
        },
      },
    ],
    authors: [
      {
        id: 'author-1',
        slug: 'ada',
        publishedAt: null,
        data: { slug: 'ada', name: 'Ada' },
      },
    ],
  },
  schema: rawSchema,
}

const appSource = `import { expectTypeOf } from 'vitest'
import type { Entry } from '@areca-cms/site-sdk'
import { content } from './areca.gen.js'

const posts = content.blogPosts.all({
  where: { coverImage: { isNull: false }, category: { in: ['news'] } },
  with: { author: true },
})
expectTypeOf(posts[0].data.author).toEqualTypeOf<Entry<'authors'> | null | undefined>()
expectTypeOf(posts[0].data.title).toEqualTypeOf<string>()

const first = content.blogPosts.first()
expectTypeOf(first).toEqualTypeOf<Entry<'blogPosts'> | undefined>()

if (first) {
  expectTypeOf(content.resolve(first.data.editor)).toEqualTypeOf<Entry<'authors'> | null>()
  expectTypeOf(content.href(first.data.editor)).toEqualTypeOf<\`/authors/\${string}\`>()
}
expectTypeOf(content.blogPosts.href(posts[0])).toEqualTypeOf<\`/blog/\${string}\`>()

// @ts-expect-error raw CMS collection keys are not exposed
content['blog-posts']
// @ts-expect-error camelCase field keys only
posts[0].data['cover-image']
// @ts-expect-error category has no option called nope
content.blogPosts.all({ where: { category: 'nope' } })
// @ts-expect-error only reference fields can be expanded with
content.blogPosts.all({ with: { title: true } })
`

/** Site-content globals, raw keys, as a publication snapshot carries them. */
const rawGlobalSchema: NonNullable<Snapshot['globalSchema']> = {
  'company-info': {
    label: 'Company info',
    seo: false,
    fields: [
      { key: 'email', label: 'Email', type: 'text', required: true, group: 'Contact' },
      { key: 'phone-number', label: 'Phone number', type: 'text', group: 'Contact' },
      { key: 'plan', label: 'Plan', type: 'select', options: ['basic', 'pro'] },
      {
        key: 'featured-author',
        label: 'Featured author',
        type: 'reference',
        collection: 'authors',
      },
    ],
  },
  'home-page': {
    label: 'Home page',
    seo: true,
    previewPath: '/',
    fields: [{ key: 'hero-title', label: 'Hero title', type: 'text', required: true }],
  },
}

const globalsSnapshot: Snapshot = {
  ...snapshot,
  globalSchema: rawGlobalSchema,
  globals: {
    'company-info': {
      id: 'g-company',
      publishedAt: null,
      data: { email: 'hi@acme.test', plan: 'pro' },
    },
    'home-page': {
      id: 'g-home',
      publishedAt: null,
      data: { 'hero-title': 'Welcome' },
    },
  },
}

/* Plain source: no template literals, so the app text needs no escaping. */
const globalsAppSource = `import { expectTypeOf } from 'vitest'
import type { Entry, SeoMeta } from '@areca-cms/site-sdk'
import { content, type CompanyInfoGlobal } from './areca.gen.js'

const info = content.globals.companyInfo
expectTypeOf(info).toEqualTypeOf<CompanyInfoGlobal>()
expectTypeOf(info.email).toEqualTypeOf<string>()
expectTypeOf(info.phoneNumber).toEqualTypeOf<string | null | undefined>()
expectTypeOf(info.plan).toEqualTypeOf<'basic' | 'pro' | null | undefined>()
expectTypeOf(content.resolve(info.featuredAuthor)).toEqualTypeOf<Entry<'authors'> | null>()
expectTypeOf(content.globals.homePage.heroTitle).toEqualTypeOf<string>()
expectTypeOf(content.globals.homePage.$seo).toEqualTypeOf<SeoMeta>()

// @ts-expect-error there is no global called nope
content.globals.nope
// @ts-expect-error raw CMS global keys are not exposed
content.globals['company-info']
// @ts-expect-error $seo only exists on globals with seo enabled
content.globals.companyInfo.$seo
// @ts-expect-error camelCase field keys only
content.globals.companyInfo['phone-number']
`

/** Compiles the root files against the real SDK sources and returns the formatted diagnostics. */
function compileDiagnostics(rootNames: string[], cwd: string): string {
  const program = ts.createProgram({
    rootNames,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      verbatimModuleSyntax: true,
      types: ['node'],
      typeRoots: [join(packageDir, 'node_modules', '@types')],
      paths: {
        '@areca-cms/site-sdk': [join(sdkSrc, 'index.ts')],
        '@areca-cms/site-sdk/content': [join(sdkSrc, 'content.ts')],
        vitest: [join(packageDir, 'node_modules', 'vitest', 'dist', 'index.d.ts')],
      },
    },
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => cwd,
    getNewLine: () => '\n',
  })
}

describe('generated content object compiles in an app', () => {
  it('types the ready content export with zero diagnostics', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'areca-typed-app-'))
    try {
      expect(snapshot.schema).toEqual(rawSchema)
      const generated = generateContentTypes({
        schema: rawSchema,
        dir: 'src/generated/content',
      })
      expect(generated).toContain('interface Register')
      writeFileSync(join(workDir, 'areca.gen.ts'), generated)
      writeFileSync(join(workDir, 'app.ts'), appSource)

      const output = compileDiagnostics(
        [join(workDir, 'app.ts'), join(workDir, 'areca.gen.ts')],
        workDir,
      )
      if (output !== '') console.error(output)
      expect(output).toBe('')
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  }, 60_000)

  it('types content.globals from the generated globalSchema with zero diagnostics', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'areca-typed-globals-'))
    try {
      expect(globalsSnapshot.globalSchema).toEqual(rawGlobalSchema)
      const generated = generateContentTypes({
        schema: rawSchema,
        globalSchema: rawGlobalSchema,
        dir: 'src/generated/content',
      })
      expect(generated).toContain('globals: typeof globalSchema')
      writeFileSync(join(workDir, 'areca.gen.ts'), generated)
      writeFileSync(join(workDir, 'app.ts'), globalsAppSource)

      const output = compileDiagnostics(
        [join(workDir, 'app.ts'), join(workDir, 'areca.gen.ts')],
        workDir,
      )
      if (output !== '') console.error(output)
      expect(output).toBe('')
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  }, 60_000)
})
