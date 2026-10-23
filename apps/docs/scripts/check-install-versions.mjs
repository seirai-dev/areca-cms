// Fails when a docs install command names another version of a package the SDK
// depends on than the one the SDK pins. Runs after `vite build` and in the docs
// tests. The SDK's own package.json is the source of truth.
import { globSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const SDK_MANIFEST = join(repoRoot, 'packages', 'site-sdk', 'package.json')

// `@scope/name@1.2.3`: scoped packages, which is how the SDK's dependencies are published.
const PACKAGE_VERSION = /(@[a-z0-9._-]+\/[a-z0-9._-]+)@([0-9][^\s'"`<>)]*)/g

/**
 * Every `@scope/name@version` in the documents whose name the SDK depends on
 * must equal the SDK's pinned version. Returns one line per mismatch.
 */
export function findVersionDrift(dependencies, documents) {
  const problems = []
  for (const { path, text } of documents) {
    text.split('\n').forEach((line, index) => {
      for (const [, name, version] of line.matchAll(PACKAGE_VERSION)) {
        const pinned = dependencies[name]
        if (pinned === undefined) continue
        const expected = pinned.replace(/^[\^~]/, '')
        if (version !== expected) {
          problems.push(
            `${path}:${index + 1}: ${name}@${version} does not match the SDK's ${name}@${expected}`,
          )
        }
      }
    })
  }
  return problems
}

/** The documents this check reads: the docs app and the repository docs. */
export function docDocuments(root = repoRoot) {
  const files = [
    ...globSync('apps/docs/content/**/*.mdx', { cwd: root }),
    ...globSync('docs/**/*.md', { cwd: root }),
  ]
  return files.sort().map((file) => ({
    path: relative(root, join(root, file)),
    text: readFileSync(join(root, file), 'utf8'),
  }))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(SDK_MANIFEST, 'utf8'))
  const problems = findVersionDrift(manifest.dependencies ?? {}, docDocuments())
  if (problems.length > 0) {
    console.error(`Docs install commands drift from the SDK's pinned dependencies:\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.log('Docs install versions match the SDK dependencies.')
}
