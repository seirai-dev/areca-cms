// The public site, after Go live: the new coffee is on the shop page.
import { session, CMS } from '../harness.mjs'
import { env } from '../env.mjs'
const SITE_URL = env('CAPTURE_LIVE_SITE_URL')
const cmsHost = new URL(CMS).host
const r = await session('09-livesite')
const { page } = r
// Track requests to the CMS host while browsing the published site.
const cmsCalls = []
page.on('request', (req) => {
  if (new URL(req.url()).host === cmsHost) cmsCalls.push(req.url())
})
await r.goto(`${SITE_URL}/coffees`)
await r.move({ x: 760, y: 300 }, 10)
await r.start()
await r.wait(900)
const card = page.locator('a[href*="panama-boquete-geisha"]').first()
await card.scrollIntoViewIfNeeded().catch(() => {})
await r.wait(600)
await r.click(card, { ms: 1100 })
await page.waitForLoadState('networkidle').catch(() => {})
await r.wait(1500)
await page.mouse.wheel(0, 500)
await r.wait(1400)
await r.stop()
await r.shot('/tmp/areca-landing/explore/live-end.png')
console.log('requests to CMS host:', cmsCalls.length, cmsCalls.slice(0, 5))
await r.close()
