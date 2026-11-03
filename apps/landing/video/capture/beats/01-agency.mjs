// Agency overview, then hop between client sites with the switcher and ⌘K.
import { session, CMS } from '../harness.mjs'
const r = await session('01-agency')
const { page } = r
await r.goto(`${CMS}/agency`)
await r.move({ x: 760, y: 420 }, 10)
await r.start()
await r.wait(900)
await r.move('[data-testid="agency-sites"] >> text=emirkaan.be', 900)
await r.wait(500)
// Open the workspace switcher and jump to emirkaan.be
const switcher = page.locator('[data-testid="sidebar"] button').first()
await r.click(switcher)
await r.wait(700)
await r.click(
  '[data-testid="switch-site-emirkaan-be"], [role="menu"] >> text=emirkaan.be',
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
