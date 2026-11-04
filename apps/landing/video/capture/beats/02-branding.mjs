// White-label: change the accent colour and the whole CMS follows.
// Restores production's original teal (#1f8a8a) as a side effect.
import { session, CMS } from '../harness.mjs'
const r = await session('02-branding')
const { page } = r
await r.goto(`${CMS}/agency/branding`)
await r.move({ x: 900, y: 400 }, 10)
await r.start()
await r.wait(700)
const accent = page.locator('[data-testid="brand-accent"]')
await accent.scrollIntoViewIfNeeded()
await r.wait(300)
await r.click(accent, { ms: 900 })
await page.keyboard.press('Meta+a')
await r.type('#1f8a8a', 120)
await r.wait(1400)
await r.click('[data-testid="save-branding"]', { ms: 900 })
await r.wait(1800)
await r
  .click('[data-testid="sidebar"] a[href="/agency"]', { ms: 900 })
  .catch(async () => {
    await r.goto(`${CMS}/agency`)
  })
await page.waitForLoadState('networkidle').catch(() => {})
await r.wait(1800)
await r.stop()
console.log(
  'accent saved as',
  await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue(
      '--color-accent',
    ),
  ),
)
await r.shot('/tmp/areca-landing/explore/b-end.png')
await r.close()
