// Go live from the release panel and follow the build until the site is live.
import { session, SITE } from '../harness.mjs'
const r = await session('08-golive')
const { page } = r
await r.goto(`${SITE}`)
await r.move({ x: 900, y: 420 }, 10)
await r.start()
await r.wait(800)
await r.click(
  '[data-testid="golive-pill"], [data-testid="release-status"] >> nth=0',
  { ms: 1000 },
)
await page.locator('[data-testid="golive-panel"]').waitFor()
await r.wait(1500)
await r.shot('/tmp/areca-landing/explore/g-panel.png')
await r.click('[data-testid="publish-site-confirm"]', { ms: 1000 })
const t0 = Date.now()
// Follow the build: wait until the release reports live (up to 8 minutes).
await page
  .waitForFunction(
    () =>
      /up to date|is live|live now/i.test(
        document.querySelector('[data-testid="golive-panel"]')?.textContent ??
          '',
      ),
    null,
    { timeout: 480000, polling: 1000 },
  )
  .catch((e) => console.log('wait', e.message))
console.log('build seconds', Math.round((Date.now() - t0) / 1000))
await r.wait(2500)
await r.stop()
await r.shot('/tmp/areca-landing/explore/g-end.png')
await r.close()
