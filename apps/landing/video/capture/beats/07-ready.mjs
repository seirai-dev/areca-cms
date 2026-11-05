// Owner approves the entry: Mark as ready.
import { session, SITE } from '../harness.mjs'
import { env } from '../env.mjs'
const r = await session('07-ready')
const { page } = r
await r.goto(`${SITE}/c/${env('CAPTURE_ENTRY_PATH')}`)
await r.move({ x: 900, y: 420 }, 10)
await r.start()
await r.wait(700)
await r.click('[data-testid="publish-now"]', { ms: 1000 })
await r.wait(2500)
await r.stop()
await r.shot('/tmp/areca-landing/explore/r-end.png')
await r.close()
