import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'
const cwd = fileURLToPath(new URL('../../', import.meta.url))
test('real Node with tsx redirects both alias and resolved Paraglide imports', () => {
  execFileSync('pnpm', ['run', 'paraglide:scripts'], { cwd, stdio: 'pipe' })
  const code = `const a=await import('#/paraglide/messages');const b=await import('./src/paraglide/messages.js');if(a.m.admin_cancel()!=='Cancel'||b.m.admin_cancel()!=='Cancel')throw Error('wrong runtime');console.log('ok')`
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--import',
      './scripts/lib/script-runtime.mjs',
      '--input-type=module',
      '-e',
      code,
    ],
    { cwd, encoding: 'utf8' },
  )
  assert.equal(output.trim(), 'ok')
})
