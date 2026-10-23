import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { docDocuments, findVersionDrift } from './check-install-versions.mjs'

const dependencies = { '@tanstack/markdown': '1.0.0', '@clack/prompts': '^1.8.1' }

test('accepts install commands at the pinned version, with or without a range marker', () => {
  const documents = [
    { path: 'a.mdx', text: 'pnpm add @tanstack/markdown@1.0.0\nnpm install @clack/prompts@1.8.1' },
  ]
  assert.deepEqual(findVersionDrift(dependencies, documents), [])
})

test('reports every install command at another version, with its location', () => {
  const documents = [
    {
      path: 'apps/docs/content/docs/sdk/rich-text.mdx',
      text: 'intro\n<Tab>`pnpm add @tanstack/markdown@0.0.15`</Tab>\n`npm install @tanstack/markdown@0.0.15`',
    },
  ]
  assert.deepEqual(findVersionDrift(dependencies, documents), [
    "apps/docs/content/docs/sdk/rich-text.mdx:2: @tanstack/markdown@0.0.15 does not match the SDK's @tanstack/markdown@1.0.0",
    "apps/docs/content/docs/sdk/rich-text.mdx:3: @tanstack/markdown@0.0.15 does not match the SDK's @tanstack/markdown@1.0.0",
  ])
})

test('ignores packages the SDK does not depend on', () => {
  const documents = [{ path: 'b.md', text: 'pnpm add @areca-cms/site-sdk@0.5.0 @fumadocs/base-ui@16.17.1' }]
  assert.deepEqual(findVersionDrift(dependencies, documents), [])
})

test('the repository docs agree with the SDK dependencies', () => {
  const sdk = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'site-sdk', 'package.json'), 'utf8'),
  )
  assert.deepEqual(findVersionDrift(sdk.dependencies, docDocuments()), [])
})
