// Generate SEO and answer-engine fields with AI, review, apply.
import { session, SITE } from '../harness.mjs'
const ENTRY = `${SITE}/c/coffees/15e9aebd-1499-4697-a2e6-17356875b8a5`
const r = await session('06-seo')
const { page } = r
await r.goto(ENTRY)
await page.locator('[data-testid="language-tab-en"]').click()
await r.wait(800)
await r.move({ x: 700, y: 400 }, 10)
await r.start()
await r.wait(500)
await r.click('[data-testid="topbar-ai-seo"]', { ms: 900 })
await page.locator('[data-testid="ai-seo-dialog"]').waitFor()
await r.wait(600)
await r.shot('/tmp/areca-landing/explore/s-open.png')
// Some versions ask to start; click generate if it is there.
const gen = page.locator(
  '[data-testid="ai-seo-dialog"] button:has-text("Generate")',
)
if (await gen.count()) await r.click(gen.first(), { ms: 600 })
await page.locator('[data-testid="ai-seo-apply"]').waitFor({ timeout: 120000 })
await page
  .locator('[data-testid="ai-seo-loading"]')
  .waitFor({ state: 'detached', timeout: 120000 })
  .catch(() => {})
await r.wait(1000)
await r.shot('/tmp/areca-landing/explore/s-result.png')
// Scroll the suggestions so viewers see title, description and FAQ.
const body = page.locator('[data-testid="ai-seo-dialog"]')
await r.move(body, 800)
await page.mouse.wheel(0, 380)
await r.wait(1200)
await page.mouse.wheel(0, 380)
await r.wait(1200)
await r.click('[data-testid="ai-seo-apply"]', { ms: 900 })
await r.wait(1500)
await page.keyboard.press('Meta+s')
await r.wait(1500)
await r.stop()
await r.shot('/tmp/areca-landing/explore/s-end.png')
await r.close()
