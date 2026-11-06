// Agency overview, then hop between client sites with the switcher and ⌘K.
import { session, CMS } from '../harness.mjs'
import { env } from '../env.mjs'

// The second client site to hop to, by its display name.
const OTHER_SITE = env('CAPTURE_OTHER_SITE')
const otherSlug = OTHER_SITE.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const r = await session('01-agency')
const { page } = r
await r.goto(`${CMS}/agency`)
await r.move({ x: 760, y: 420 }, 10)
await r.start()
await r.wait(900)
await r.move(`[data-testid="agency-sites"] >> text=${OTHER_SITE}`, 900)
await r.wait(500)
// Open the workspace switcher and jump to the other site
const switcher = page.locator('[data-testid="sidebar"] button').first()
await r.click(switcher)
await r.wait(700)
await r.click(
  `[data-testid="switch-site-${otherSlug}"], [role="menu"] >> text=${OTHER_SITE}`,
)
await page.waitForLoadState('networkidle').catch(() => {})
await r.wait(1600)
// ⌘K to jump back to the demo site
await r.move({ x: 700, y: 300 }, 500)
await page.keyboard.press('Meta+k')
await r.wait(500)
await r.type('Demo App', 70)
await r.wait(700)
await page.keyboard.press('Enter')
await page.waitForLoadState('networkidle').catch(() => {})
await r.wait(1800)
await r.stop()
await r.shot('/tmp/areca-landing/explore/beat1-end.png')
await r.close()
