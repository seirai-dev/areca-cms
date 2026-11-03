// Continue following an in-flight release until it is live.
import { session, SITE } from '../harness.mjs'
const r = await session('08b-building')
const { page } = r
await r.goto(`${SITE}?panel=golive`)
await page.locator('[data-testid="golive-panel"]').waitFor()
await r.move({ x: 1250, y: 520 }, 10)
await r.start()
const t0 = Date.now()
await page
  .waitForFunction(
    () =>
      !/going live/i.test(
        document.querySelector('[data-testid="golive-panel"]')?.textContent ??
          '',
      ),
    null,
    { timeout: 540000, polling: 1000 },
  )
  .catch((e) => console.log('wait', e.message))
console.log('build seconds', Math.round((Date.now() - t0) / 1000))
await r.wait(3000)
await r.stop()
await r.shot('/tmp/areca-landing/explore/g2-end.png')
await r.close()
