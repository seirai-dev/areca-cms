// Write a new coffee in the canvas editor: title, notes, rich text with the
// slash menu, details, and an image from the library.
import { writeFileSync } from 'node:fs'
import { session, SITE } from '../harness.mjs'
const dbg = (n) => r.shot(`/tmp/areca-landing/explore/w-${n}.png`)
const r = await session('03-write')
const { page } = r
await r.goto(`${SITE}/c/coffees`)
await r.move({ x: 900, y: 400 }, 10)
await r.start()
await r.wait(700)
await r.click('text=New coffee >> nth=-1', { ms: 900 })
await page.locator('#field-name').waitFor()
await r.wait(600)
await r.click('#field-name')
await r.type('Panama Boquete Geisha', 55)
await r.wait(200)
// Fill the required origin early so autosave never shows an error.
await r.click('#field-origin', { ms: 700 })
await r.type('Panama', 45)
await r.wait(200)
await r.click('#field-tastingNotes', { ms: 500 })
await r.type('jasmine, white peach, bergamot', 40)
await r.wait(300)
await r.click('#field-description', { ms: 600 })
await r.type(
  'Grown at 1,700 m on the slopes of Volcán Barú, this washed Geisha is all florals: jasmine first, then white peach and a long bergamot finish.',
  18,
)
await page.keyboard.press('Enter')
await r.type('/', 0)
await r.wait(900)
await r.type('head', 90)
await r.wait(600)
await page.keyboard.press('Enter')
await r.type('How we brew it', 50)
await page.keyboard.press('Enter')
await r.type(
  'A V60 with 15 g to 250 g of water at 94 °C. Slow pour, three minutes.',
  18,
)
await r.wait(500)
// Details panel
await r.click('#field-region', { ms: 800 })
await r.type('Boquete, Chiriquí', 40)
await r.click('#field-process', { ms: 500 })
await r.wait(400)
await r.click('[role="option"]:has-text("washed")', { ms: 450 })
await r.click('#field-roastLevel', { ms: 450 })
await r.wait(300)
await r.click('[role="option"]:has-text("light")', { ms: 450 })
await r.click('#field-producer', { ms: 450 })
await r.type('Finca La Niebla', 40)
await r.wait(300)
// Image from the shared library
await page.locator('#field-image').scrollIntoViewIfNeeded()
await r.wait(500)
await r.click('#field-image', { ms: 600 })
await r.wait(1200)
await r.click(
  '[data-testid="media-asset-5afe7f72-c4f9-42de-bc90-107cd7d4321e"]',
  { ms: 800 },
)
await r.wait(1200)
await page.keyboard.press('Meta+s')
await r.wait(1500)
writeFileSync('/tmp/areca-landing/new-entry-url.txt', page.url())
await r.stop()
await dbg('end')
console.log(page.url())
await r.close()
