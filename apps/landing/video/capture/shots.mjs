// Captures the CMS screenshots used on the landing page, in dark and light,
// at 2x. Output: apps/landing/public/shots/<name>-<theme>.webp
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const CMS = 'https://areca.emirkaan-web.eu'
const SITE = `${CMS}/sites/ba7a872f-56e6-4519-9ac1-06344f56102a`
const ENTRY = `${SITE}/c/coffees/15e9aebd-1499-4697-a2e6-17356875b8a5`
const OUT = new URL('../../public/shots/', import.meta.url).pathname
const TMP = '/tmp/areca-landing/shots'
mkdirSync(OUT, { recursive: true })
mkdirSync(TMP, { recursive: true })
const only = process.argv.slice(2)

const settle = (p, ms = 1200) =>
  p
    .waitForLoadState('networkidle')
    .catch(() => {})
    .then(() => p.waitForTimeout(ms))

const shots = {
  overview: async (p) => {
    await p.goto(SITE)
    await settle(p)
  },
  agency: async (p) => {
    await p.goto(`${CMS}/agency`)
    await settle(p)
  },
  collection: async (p) => {
    await p.goto(`${SITE}/c/coffees`)
    await settle(p, 2000)
  },
  editor: async (p) => {
    await p.goto(ENTRY)
    await settle(p)
    const write = p.locator('[data-testid="editor-mode-write"]')
    await write.click()
    await settle(p, 1500)
  },
  visual: async (p) => {
    await p.goto(ENTRY)
    await settle(p)
    await p.locator('[data-testid="editor-mode-visual"]').click()
    const f = p.frameLocator('iframe[src*="__preview"]')
    await f.locator('h1[data-areca-field="name"]').waitFor({ timeout: 60000 })
    await p.waitForTimeout(2500)
    await f.locator('h1[data-areca-field="name"]').hover()
    await p.waitForTimeout(600)
  },
  languages: async (p) => {
    await p.goto(ENTRY)
    await settle(p)
    await p.locator('[data-testid="editor-mode-write"]').click()
    await p.locator('[data-testid="language-tab-nl"]').click()
    await settle(p, 1500)
  },
  seo: async (p) => {
    await p.goto(ENTRY)
    await settle(p)
    await p.locator('[data-testid="editor-mode-write"]').click()
    await p.locator('[data-testid="language-tab-en"]').click()
    await p.locator('[data-testid="topbar-ai-seo"]').click()
    await p.locator('[data-testid="ai-seo-apply"]').waitFor({ timeout: 120000 })
    await p
      .locator('[data-testid="ai-seo-loading"]')
      .waitFor({ state: 'detached', timeout: 120000 })
      .catch(() => {})
    await p.waitForTimeout(800)
  },
  golive: async (p) => {
    await p.goto(`${SITE}?panel=golive`)
    await settle(p, 1500)
    await p.locator('[data-testid="golive-panel"]').waitFor()
    await p.waitForTimeout(800)
  },
  library: async (p) => {
    await p.goto(`${SITE}/library`)
    await settle(p, 2500)
  },
  connect: async (p) => {
    await p.goto(`${SITE}/connect-ai`)
    await settle(p)
  },
  palette: async (p) => {
    await p.goto(SITE)
    await settle(p)
    await p.keyboard.press('Meta+k')
    await p.waitForTimeout(400)
    await p.keyboard.type('Pan', { delay: 80 })
    await p.waitForTimeout(1200)
  },
  people: async (p) => {
    await p.goto(`${CMS}/agency/people`)
    await settle(p)
  },
  branding: async (p) => {
    await p.goto(`${CMS}/agency/branding`)
    await settle(p)
  },
}

const browser = await chromium.launch()
for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({
    storageState: '/tmp/areca-landing/auth.json',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  })
  await ctx.addInitScript((t) => localStorage.setItem('areca.theme', t), theme)
  const page = await ctx.newPage()
  page.setDefaultTimeout(60000)
  for (const [name, run] of Object.entries(shots)) {
    if (only.length && !only.includes(name)) continue
    try {
      await run(page)
      const png = `${TMP}/${name}-${theme}.png`
      await page.screenshot({ path: png })
      await sharp(png).webp({ quality: 84 }).toFile(`${OUT}${name}-${theme}.webp`)
      console.log('ok', name, theme)
    } catch (e) {
      console.log('FAIL', name, theme, e.message.split('\n')[0])
    }
  }
  await ctx.close()
}
await browser.close()
