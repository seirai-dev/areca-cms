import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { renderAuthzMatrixDoc } from './authz-matrix/doc'

const DOC = fileURLToPath(
  new URL('../../../../../docs/AUTHZ_MATRIX.md', import.meta.url),
)

describe('docs/AUTHZ_MATRIX.md', () => {
  it('matches the matrix rows', () => {
    const current = readFileSync(DOC, 'utf8')
    const next = renderAuthzMatrixDoc(current)
    // `pnpm --filter @areca/cms authz:doc` sets this to rewrite the file.
    if (process.env.AUTHZ_DOC_WRITE === 'true') writeFileSync(DOC, next)
    else expect(current, 'run `pnpm --filter @areca/cms authz:doc`').toBe(next)
  })
})
