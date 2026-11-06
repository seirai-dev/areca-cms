// Switch to Dutch and let AI fill the empty translations, then save.
import { session, SITE } from '../harness.mjs'
import { env } from '../env.mjs'
const ENTRY = `${SITE}/c/${env('CAPTURE_ENTRY_PATH')}`
const r = await session('05-languages')
const { page } = r
await r.goto(ENTRY)
if (
  await page
    .locator(
      '[data-testid="editor-mode-write"][aria-pressed="false"], [data-testid="editor-mode-write"][data-state="off"]',
    )
    .count()
) {
  await page.locator('[data-testid="editor-mode-write"]').click()
}
await page
  .locator('[data-testid="editor-mode-write"]')
  .click()
  .catch(() => {})
await r.wait(800)
await r.move({ x: 700, y: 400 }, 10)
await r.start()
await r.wait(600)
await r.click('[data-testid="language-tab-nl"]', { ms: 900 })
await r.wait(1200)
await r.shot('/tmp/areca-landing/explore/l-nl.png')
await r.click('[data-testid="translate-language"]', { ms: 900 })
await r.wait(800)
await r.shot('/tmp/areca-landing/explore/l-after-click.png')
// Wait for the AI to fill the title field.
await page.waitForFunction(
  () => (document.querySelector('#field-name')?.value ?? '').length > 0,
  null,
  { timeout: 90000 },
)
await r.wait(2500)
await r.move({ x: 600, y: 520 }, 900)
await r.wait(800)
await page.keyboard.press('Meta+s')
await r.wait(2000)
await r.stop()
await r.shot('/tmp/areca-landing/explore/l-end.png')
await r.close()
