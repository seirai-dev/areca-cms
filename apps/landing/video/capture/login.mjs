// Signs in to the CMS once and saves the session for the capture scripts.
// Usage: node login.mjs <passwordFile> <totpPathFile> <stateOut>
import { chromium } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'

const [passwordFile, totpPathFile, stateOut] = process.argv.slice(2)
const BASE = process.env.CMS_URL ?? 'https://areca.emirkaan-web.eu'
const EMAIL = 'ozveremirkaan@gmail.com'

const browser = await chromium.launch()
const page = await browser.newPage()
page.setDefaultTimeout(90000)
await page.goto(`${BASE}/login`, {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
})
await page.locator('[data-testid="login-form"][data-ready="true"]').waitFor()
await page.locator('#email').fill(EMAIL)
await page.locator('#password').fill(readFileSync(passwordFile, 'utf8').trim())
await page.locator('[data-testid="login-form"] button[type="submit"]').click()
await page.locator('#two-factor-code').waitFor({ timeout: 90000 })
console.log('AT_2FA')
const deadline = Date.now() + 10 * 60_000
while (!existsSync(totpPathFile)) {
  if (Date.now() > deadline) throw new Error('no TOTP')
  await new Promise((r) => setTimeout(r, 150))
}
const totpFile = readFileSync(totpPathFile, 'utf8').trim()
await page
  .locator('#two-factor-code')
  .fill(readFileSync(totpFile, 'utf8').trim())
await page.locator('#two-factor-code').press('Enter')
await page.waitForURL((u) => !/login|two-factor/.test(u.pathname), {
  timeout: 90000,
})
await page.context().storageState({ path: stateOut })
console.log('LOGGED_IN', page.url())
await browser.close()
