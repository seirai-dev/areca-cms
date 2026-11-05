// Visual editor: live preview beside the fields, click a preview element to
// jump to its field, type and watch the preview update before saving.
import { session, SITE } from '../harness.mjs'
import { env } from '../env.mjs'
const ENTRY = `${SITE}/c/${env('CAPTURE_ENTRY_PATH')}`
const r = await session('04-visual')
const { page } = r
await r.goto(ENTRY)
await r.move({ x: 900, y: 300 }, 10)
await r.start()
await r.wait(600)
await r.click('[data-testid="editor-mode-visual"]', { ms: 800 })
const frame = page.frameLocator('iframe[src*="__preview"]')
await frame.locator('h1[data-areca-field="name"]').waitFor({ timeout: 60000 })
await r.wait(1800)
// Hover the preview title, then click the tasting notes on the page.
await r.move(frame.locator('h1[data-areca-field="name"]'), 900)
await r.wait(700)
await r.click(frame.locator('ul[data-areca-field="tastingNotes"]'), { ms: 800 })
await r.wait(900)
await page.keyboard.press('Meta+ArrowDown')
await r.type(', honey', 110)
await r.wait(2200)
// Jump to another field straight from the page.
await r.click(frame.locator('h1[data-areca-field="name"]'), { ms: 900 })
await r.wait(1500)
await page.keyboard.press('Meta+s')
await r.wait(1200)
await r.stop()
await r.shot('/tmp/areca-landing/explore/v-end.png')
await r.close()
