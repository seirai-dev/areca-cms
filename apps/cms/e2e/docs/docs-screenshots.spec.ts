/**
 * Documentation screenshots for apps/docs. Run with `pnpm docs:screenshots`
 * (see playwright.docs.config.ts). Not part of the normal e2e projects.
 *
 * BEFORE capturing, run `pnpm db:demo`: the shots assume the deterministic demo
 * data (Harbor & Pine, Northwind, Lumen Dental, Fieldnote, Kestrel) and the
 * admin's fixed TOTP secret. AFTER capturing, run `pnpm db:demo` again: the
 * last steps change state (a go live, a throwaway client and site, and an
 * owner's pending two-factor enrolment), and the demo must be reset.
 *
 * Shots are written to apps/docs/public/screenshots/. Read-only captures run
 * first; state-changing ones run last. Each capture is isolated, so one
 * failing screen does not hide the others; all failures are reported at the end.
 *
 * Environment:
 * - PLAYWRIGHT_BASE_URL: the CMS origin (default APP_URL from apps/cms/.env.local).
 *   Better Auth only accepts the APP_URL origin, so use that rather than localhost.
 * - PW_CHROMIUM_PATH: optional locally installed Chromium.
 */
import { createHmac } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test'

import {
  PASSWORD,
  authForm,
  entryIdFromUrl,
  hydrated,
  richText,
  siteIdFromUrl,
} from '../helpers'

const SHOTS = fileURLToPath(
  new URL('../../../docs/public/screenshots/', import.meta.url),
)

const ADMIN = 'admin@areca.local'
const HARBOR_OWNER = 'ruth@harborandpine.com'
const NORTHWIND_OWNER = 'sam@northwindcc.org'
const LUMEN_OWNER = 'niels@lumendentalstudio.com'

/** Demo admin's authenticator secret (scripts/demo-seed.ts, docs/DEVELOPMENT.md). */
const ADMIN_TOTP_BASE32 = 'MFZGKY3BFVSGK3LPFV2G65DQFVZWKY3SMV2A'

const HARBOR = 'harborandpine'
const NORTHWIND = 'northwindcc'
const LUMEN = 'lumen-dental'

const SOURDOUGH = 'entry-sourdough-starter-turns-ten'
const READY_HOURS = 'entry-saturday-hours-winter'

/* ------------------------------------------------------------------------
   TOTP (RFC 6238, the same as better-auth's default: SHA-1, 6 digits, 30 s)
------------------------------------------------------------------------ */

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const value = alphabet.indexOf(char)
    if (value < 0) throw new Error(`Not base32: ${char}`)
    buffer = ((buffer << 5) | value) & 0xffff
    bits += 5
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

function totpAt(at: number) {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const digest = createHmac('sha1', base32Decode(ADMIN_TOTP_BASE32))
    .update(message)
    .digest()
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f
  const binary =
    ((digest[offset] ?? 0) & 0x7f) * 2 ** 24 +
    ((digest[offset + 1] ?? 0) & 0xff) * 2 ** 16 +
    ((digest[offset + 2] ?? 0) & 0xff) * 2 ** 8 +
    ((digest[offset + 3] ?? 0) & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

/** A code with at least 5 s left in its window, so it is still valid on submit. */
async function freshTotp() {
  const remaining = 30_000 - (Date.now() % 30_000)
  if (remaining < 5_000)
    await new Promise((r) => setTimeout(r, remaining + 200))
  return totpAt(Date.now())
}

/* ------------------------------------------------------------------------
   Contexts, navigation, capture
------------------------------------------------------------------------ */

async function openContext(
  browser: Browser,
  options: { mobile?: boolean } = {},
): Promise<BrowserContext> {
  const mobile = options.mobile === true
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1280, height: 800 },
    deviceScaleFactor: mobile ? 3 : 2,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'Europe/London',
  })
  // Dark theme is next-themes' `areca.theme` key in localStorage.
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('areca.theme', 'dark')
    } catch {
      /* storage can be unavailable; the colour scheme still applies */
    }
  })
  return context
}

async function signInWithPassword(page: Page, email: string) {
  await page.goto('/login')
  const form = await authForm(page)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await form.getByRole('button', { name: 'Sign in' }).click()
}

async function goTo(page: Page, path: string, ready?: Locator) {
  await page.goto(path)
  await hydrated(page)
  if (ready) await expect(ready).toBeVisible({ timeout: 60_000 })
}

async function goToSite(
  page: Page,
  siteId: string,
  path: string,
  ready?: Locator,
) {
  await goTo(page, `/sites/${siteId}${path}`, ready)
}

/** Opens the entry editor for a row in a collection list. */
async function openEntry(
  page: Page,
  siteId: string,
  collection: string,
  testId: string,
) {
  await goToSite(
    page,
    siteId,
    `/c/${collection}`,
    page.getByTestId('site-content'),
  )
  await expect(page.getByTestId('site-content')).toHaveAttribute(
    'data-ready',
    'true',
  )
  const row = page.getByTestId(testId)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.getByRole('link').first().click()
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
    {
      timeout: 60_000,
    },
  )
  await hydrated(page, page.getByTestId('entry-editor'))
  return entryIdFromUrl(page)
}

/** Waits for web fonts, images and network quiet, then writes the PNG. */
async function shot(
  page: Page,
  name: string,
  options: { target?: Locator } = {},
) {
  await page.addStyleTag({
    content: '[data-sonner-toaster]{display:none!important}',
  })
  await page.evaluate(() => document.fonts.ready)
  await page
    .waitForLoadState('networkidle', { timeout: 15_000 })
    .catch(() => {})
  await page
    .waitForFunction(
      () => Array.from(document.images).every((img) => img.complete),
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => {})
  await page.mouse.move(0, 0)
  const target = options.target ?? page
  const common = {
    path: `${SHOTS}${name}`,
    animations: 'disabled' as const,
    caret: 'hide' as const,
  }
  if (options.target) await target.screenshot(common)
  else await page.screenshot(common)
}

/** Keep going after a failed capture and report every failure at the end. */
const failures: string[] = []
let activeBrowser: Browser | null = null
async function capture(name: string, run: () => Promise<void>) {
  try {
    await run()
    console.log(`captured ${name}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push(`${name}: ${message.split('\n')[0]}`)
    console.error(`FAILED ${name}: ${message.split('\n')[0]}`)
    await dumpPages(name)
  }
}

/** Debug aid for a failed capture: URL and ARIA snapshot of every open page. */
async function dumpPages(name: string) {
  if (!activeBrowser) return
  const dir = process.env.DOCS_DEBUG_DIR
  if (!dir) return
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(dir, { recursive: true })
  let index = 0
  for (const context of activeBrowser.contexts()) {
    for (const page of context.pages()) {
      index += 1
      const snapshot = await page
        .locator('body')
        .ariaSnapshot({ timeout: 5_000 })
        .catch((e: Error) => `snapshot failed: ${e.message}`)
      await writeFile(
        `${dir}/${name}.${index}.txt`,
        `${page.url()}\n\n${snapshot}`,
      )
    }
  }
}

async function closeWithEscape(page: Page) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

/* ------------------------------------------------------------------------
   The capture run
------------------------------------------------------------------------ */

test.describe('documentation screenshots', () => {
  test('captures every shot listed in docs/DEVELOPMENT.md', async ({
    browser,
  }) => {
    test.setTimeout(60 * 60_000)
    activeBrowser = browser
    expect(base32Decode(ADMIN_TOTP_BASE32).toString()).toBe(
      'areca-demo-totp-secret',
    )

    /* ---------- Admin: sign in with TOTP (also shows the challenge step) ---------- */
    const adminContext = await openContext(browser)
    const admin = await adminContext.newPage()
    let loginAt = 0

    await capture('two-factor-authentication.png', async () => {
      await admin.goto('/login')
      const form = await authForm(admin)
      await admin.getByLabel('Email').fill(ADMIN)
      await admin.getByLabel('Password').fill(PASSWORD)
      await form.getByRole('button', { name: 'Sign in' }).click()
      const challenge = admin.getByTestId('two-factor-form')
      await expect(challenge).toHaveAttribute('data-ready', 'true', {
        timeout: 30_000,
      })
      await admin.waitForTimeout(400)
      await shot(admin, 'two-factor-authentication.png')
    })
    // Finish the admin sign-in even if the capture above failed.
    await expect(admin.getByTestId('two-factor-form')).toBeVisible({
      timeout: 60_000,
    })
    await admin.locator('#two-factor-code').fill(await freshTotp())
    await admin
      .getByTestId('two-factor-form')
      .locator('button[type="submit"]')
      .click()
    await expect(admin).not.toHaveURL(/\/login/, { timeout: 60_000 })
    loginAt = Date.now()

    const harborId = await (async () => {
      await goTo(admin, '/sites', admin.getByTestId('sites-page'))
      await admin.getByTestId(`site-card-${HARBOR}`).click()
      await expect(admin).toHaveURL(/\/sites\/[^/?#]+/)
      return siteIdFromUrl(admin)
    })()
    const lumenId = await (async () => {
      await goTo(admin, '/sites', admin.getByTestId('sites-page'))
      await admin.getByTestId(`site-card-${LUMEN}`).click()
      await expect(admin).toHaveURL(/\/sites\/[^/?#]+/)
      return siteIdFromUrl(admin)
    })()

    /* ---------- Admin: read-only screens ---------- */
    await capture('current-agency-ai.png', async () => {
      await goTo(admin, '/agency/ai', admin.getByTestId('ai-settings-page'))
      await shot(admin, 'current-agency-ai.png')
    })
    await capture('current-branding.png', async () => {
      await goTo(admin, '/agency/branding', admin.getByTestId('branding-page'))
      await shot(admin, 'current-branding.png')
    })
    await capture('current-deployment-settings.png', async () => {
      await goToSite(
        admin,
        harborId,
        '/settings?tab=deployment',
        admin.getByTestId('settings-tab-deployment'),
      )
      await expect(
        admin.getByTestId('settings-tab-deployment'),
      ).toHaveAttribute('aria-selected', 'true')
      await shot(admin, 'current-deployment-settings.png')
    })
    await capture('current-content-schema.png', async () => {
      await goToSite(
        admin,
        harborId,
        '/settings?tab=content',
        admin.getByTestId('content-types'),
      )
      await admin.getByTestId('content-type-posts').click()
      await expect(admin.getByTestId('collection-drawer')).toBeVisible()
      await admin.waitForTimeout(400)
      await shot(admin, 'current-content-schema.png')
      await closeWithEscape(admin)
    })
    await capture('current-developer-settings.png', async () => {
      await goToSite(
        admin,
        harborId,
        '/settings?tab=developer',
        admin.getByTestId('settings-developer'),
      )
      await shot(admin, 'current-developer-settings.png')
      await shot(admin, 'guide-developer-settings.png')
    })
    await capture('settings-languages.png', async () => {
      await goToSite(
        admin,
        lumenId,
        '/settings?tab=languages',
        admin.getByTestId('settings-languages'),
      )
      await shot(admin, 'settings-languages.png')
    })
    await capture('site-content-editor.png', async () => {
      await goToSite(
        admin,
        harborId,
        '/globals/company',
        admin.getByTestId('global-editor'),
      )
      await shot(admin, 'site-content-editor.png')
    })
    await capture('site-activity.png', async () => {
      await goToSite(
        admin,
        harborId,
        '/activity',
        admin.getByTestId('activity-panel'),
      )
      await shot(admin, 'site-activity.png')
    })

    /* ---------- Owner, desktop: read-only screens ---------- */
    const ownerContext = await openContext(browser)
    const owner = await ownerContext.newPage()
    await signInWithPassword(owner, HARBOR_OWNER)
    await expect(owner).not.toHaveURL(/\/login/, { timeout: 60_000 })

    await capture('current-collection.png', async () => {
      await goToSite(
        owner,
        harborId,
        '/c/posts',
        owner.getByTestId('site-content'),
      )
      await expect(owner.getByTestId('site-content')).toHaveAttribute(
        'data-ready',
        'true',
      )
      await owner
        .getByTestId('status-filter-all')
        .click()
        .catch(() => {})
      await shot(owner, 'current-collection.png')
    })
    await capture('current-mobile-collection.png', async () => {
      const mobileContext = await openContext(browser, { mobile: true })
      const mobile = await mobileContext.newPage()
      await signInWithPassword(mobile, HARBOR_OWNER)
      await expect(mobile).not.toHaveURL(/\/login/, { timeout: 60_000 })
      await goToSite(
        mobile,
        harborId,
        '/c/posts',
        mobile.getByTestId('site-content'),
      )
      await expect(mobile.getByTestId('site-content')).toHaveAttribute(
        'data-ready',
        'true',
      )
      await shot(mobile, 'current-mobile-collection.png')
      await mobileContext.close()
    })
    await capture('guide-posts-collection.png', async () => {
      await goToSite(
        owner,
        harborId,
        '/c/posts',
        owner.getByTestId('site-content'),
      )
      await expect(owner.getByTestId('site-content')).toHaveAttribute(
        'data-ready',
        'true',
      )
      await shot(owner, 'guide-posts-collection.png')
    })

    await capture('current-editor-answers.png', async () => {
      await openEntry(owner, harborId, 'posts', SOURDOUGH)
      await shot(owner, 'current-editor-answers.png')
    })
    await capture('current-editor-seo.png', async () => {
      await owner.getByTestId('entry-editor').waitFor()
      // Desktop shows the details panel by default; only open it when hidden.
      if (!(await owner.getByTestId('entry-details').isVisible())) {
        await owner.getByTestId('toggle-details').click()
      }
      await expect(owner.getByTestId('details-seo')).toBeVisible({
        timeout: 20_000,
      })
      const toggle = owner.getByTestId('seo-group-search-toggle')
      if ((await toggle.getAttribute('aria-expanded')) !== 'true')
        await toggle.click()
      await expect(owner.getByTestId('seo-group-search')).toBeVisible()
      await owner.getByTestId('seo-group-search').scrollIntoViewIfNeeded()
      await shot(owner, 'current-editor-seo.png')
    })
    await capture('current-seo-search.png', async () => {
      const preview = owner.getByTestId('seo-search-preview')
      await expect(preview).toBeVisible({ timeout: 20_000 })
      await preview.scrollIntoViewIfNeeded()
      await shot(owner, 'current-seo-search.png')
    })
    await capture('entry-history.png', async () => {
      const history = owner.getByTestId('details-history')
      await history.scrollIntoViewIfNeeded()
      await expect(owner.getByTestId('entry-history')).toBeVisible()
      await shot(owner, 'entry-history.png')
    })

    await capture('guide-entry-editor.png', async () => {
      await openEntry(owner, harborId, 'posts', 'entry-inside-the-4am-shift')
      await expect(owner.getByTestId('entry-status')).toBeVisible()
      await shot(owner, 'guide-entry-editor.png')
    })
    await capture('rich-text-slash-menu.png', async () => {
      const body = richText(owner)
      await body.click()
      await owner.keyboard.press('ControlOrMeta+End')
      await owner.keyboard.press('Enter')
      await owner.keyboard.type('/')
      await expect(owner.getByTestId('rich-text-slash-menu')).toBeVisible({
        timeout: 10_000,
      })
      await shot(owner, 'rich-text-slash-menu.png')
      await owner.keyboard.press('Escape')
    })

    await capture('guide-mark-ready.png', async () => {
      await openEntry(owner, harborId, 'posts', READY_HOURS)
      await expect(owner.getByTestId('entry-status')).toBeVisible()
      // Ready state: the top bar shows Ready, and the details status card says so.
      if (!(await owner.getByTestId('entry-details').isVisible())) {
        await owner.getByTestId('toggle-details').click()
      }
      await expect(
        owner.getByTestId('details-status').getByText('Ready to go live'),
      ).toBeVisible()
      await owner.getByTestId('details-status').scrollIntoViewIfNeeded()
      await shot(owner, 'guide-mark-ready.png')
    })
    await capture('schedule-sheet.png', async () => {
      await owner.getByTestId('publish-menu').click()
      await owner.getByTestId('schedule-entry').click()
      await expect(owner.getByTestId('schedule-popover')).toBeVisible({
        timeout: 10_000,
      })
      await shot(owner, 'schedule-sheet.png')
      await closeWithEscape(owner)
    })

    await capture('editor-language-bar.png', async () => {
      const lumenOwnerContext = await openContext(browser)
      const lumen = await lumenOwnerContext.newPage()
      await signInWithPassword(lumen, LUMEN_OWNER)
      await expect(lumen).not.toHaveURL(/\/login/, { timeout: 60_000 })
      await openEntry(lumen, lumenId, 'services', 'entry-dental-implants')
      await lumen.getByTestId('language-tab-nl').click()
      await expect(lumen.getByTestId('language-bar')).toBeVisible()
      await shot(lumen, 'editor-language-bar.png')
      await lumenOwnerContext.close()
    })

    await capture('current-people.png', async () => {
      await goToSite(
        owner,
        harborId,
        '/people',
        owner.getByTestId('people-page'),
      )
      await expect(owner.getByTestId('pending-invitations')).toBeVisible()
      await shot(owner, 'current-people.png')
    })
    await capture('invite-people.png', async () => {
      await owner.getByTestId('invite-member').first().click()
      await expect(owner.getByTestId('invite-sheet')).toBeVisible()
      await shot(owner, 'invite-people.png')
      await closeWithEscape(owner)
    })

    await capture('current-library.png', async () => {
      const nwOwnerContext = await openContext(browser)
      const nw = await nwOwnerContext.newPage()
      await signInWithPassword(nw, NORTHWIND_OWNER)
      await expect(nw).not.toHaveURL(/\/login/, { timeout: 60_000 })
      const nwId = await (async () => {
        await goTo(nw, '/sites', nw.getByTestId('sites-page'))
        await nw.getByTestId(`site-card-${NORTHWIND}`).click()
        await expect(nw).toHaveURL(/\/sites\/[^/?#]+/)
        return siteIdFromUrl(nw)
      })()
      await goToSite(nw, nwId, '/library', nw.getByTestId('library-page'))
      await expect(nw.getByTestId('library-grid')).toBeVisible({
        timeout: 30_000,
      })
      await shot(nw, 'current-library.png')
      await capture('library-file-details.png', async () => {
        await nw
          .getByTestId('library-grid')
          .locator('[data-testid^="media-card-"]')
          .first()
          .click()
        await expect(nw.getByTestId('asset-drawer')).toBeVisible()
        await nw.waitForTimeout(400)
        await shot(nw, 'library-file-details.png')
        await closeWithEscape(nw)
      })
      await nwOwnerContext.close()
    })

    await capture('connect-ai-connector-url.png', async () => {
      await goToSite(owner, harborId, '/connect-ai')
      await shot(owner, 'connect-ai-connector-url.png')
    })

    await capture('two-factor-setup.png', async () => {
      await goTo(owner, '/account', owner.getByTestId('two-factor-section'))
      await owner.getByTestId('two-factor-enable').click()
      await owner
        .getByTestId('two-factor-password')
        .locator('input[type="password"]')
        .fill(PASSWORD)
      await owner
        .getByTestId('two-factor-password')
        .locator('button[type="submit"]')
        .click()
      await expect(owner.getByTestId('two-factor-qr')).toBeVisible({
        timeout: 30_000,
      })
      await shot(owner, 'two-factor-setup.png')
      await closeWithEscape(owner)
    })

    await capture('current-releases.png', async () => {
      await goToSite(
        owner,
        harborId,
        '?panel=golive',
        owner.getByTestId('golive-panel'),
      )
      await shot(owner, 'current-releases.png')
      await shot(owner, 'guide-go-live-panel.png')
    })

    /* ---------- Admin: state-changing wizards (no confirm) ---------- */
    await capture('guide-create-client.png', async () => {
      await goTo(
        admin,
        '/agency/clients',
        admin.getByTestId('organizations-page'),
      )
      await admin.getByTestId('new-organization').first().click()
      await expect(admin.getByTestId('new-client-sheet')).toBeVisible()
      await admin.getByTestId('org-name').fill('Harbor & Pine Bakery')
      await shot(admin, 'guide-create-client.png')
      await closeWithEscape(admin)
    })
    await capture('guide-create-site.png', async () => {
      await goTo(
        admin,
        '/agency/clients',
        admin.getByTestId('organizations-page'),
      )
      // Follow the row's link directly: the stretched link is not always clickable.
      const href = await admin
        .getByRole('link', { name: /^Harbor & Pine Bakery/ })
        .first()
        .getAttribute('href')
      await admin.goto(href!)
      await expect(admin.getByTestId('organization-page')).toBeVisible()
      await admin.getByTestId('new-site').first().click()
      await expect(admin.getByTestId('new-site-sheet')).toBeVisible()
      await admin.getByTestId('site-name').fill('Harbor & Pine')
      await admin.getByTestId('site-slug-edit').click()
      await admin.getByTestId('site-slug').fill('harbor-and-pine')
      await admin
        .getByTestId('site-production-url')
        .fill('https://harborandpine.com')
      await shot(admin, 'guide-create-site.png')
      await closeWithEscape(admin)
    })

    await capture('guide-site-token.png', async () => {
      // A throwaway client, so the real Harbor & Pine client is left as seeded.
      await goTo(
        admin,
        '/agency/clients',
        admin.getByTestId('organizations-page'),
      )
      await admin.getByTestId('new-organization').first().click()
      await admin.getByTestId('org-name').fill('Harbor & Pine Bakery')
      await admin.getByTestId('create-client').click()
      await expect(admin.getByTestId('client-slug')).toBeVisible({
        timeout: 30_000,
      })
      await admin.getByTestId('new-site').first().click()
      await admin.getByTestId('site-name').fill('Harbor & Pine')
      await admin
        .getByTestId('site-production-url')
        .fill('https://harborandpine.com')
      await admin.getByTestId('create-site').click()
      await expect(admin.getByTestId('site-token-value').first()).toBeVisible({
        timeout: 30_000,
      })
      // Swap the real token for a fixed fake so the docs never show a live secret.
      await admin.evaluate(
        ({ fakeToken, fakeUrl, fakeSnippetToken }) => {
          // Both the site token and the schema token are on this page; mask every instance.
          const values = Array.from(
            document.querySelectorAll('[data-testid="site-token-value"]'),
          )
          const realTokens = values.map((el) => el.textContent.trim())
          values.forEach((el) => {
            el.textContent = fakeToken
          })
          const envs = Array.from(
            document.querySelectorAll('[data-testid="site-token-env"]'),
          )
          for (const env of envs) {
            const walker = document.createTreeWalker(env, NodeFilter.SHOW_TEXT)
            const texts: Text[] = []
            while (walker.nextNode()) texts.push(walker.currentNode as Text)
            for (const node of texts) {
              const text = node.textContent
              if (/^https?:\/\//.test(text.trim())) node.textContent = fakeUrl
              else {
                const real = realTokens.find(
                  (token) => token && text.includes(token),
                )
                if (real)
                  node.textContent = text.replace(real, fakeSnippetToken)
              }
            }
          }
        },
        {
          fakeToken: 'areca_site_7f3k••••••••••••••••••••',
          fakeUrl: 'https://cms.example.com',
          fakeSnippetToken: 'areca_site_7f3k••••…',
        },
      )
      await shot(admin, 'guide-site-token.png')
      await admin
        .getByTestId('site-token-done')
        .click()
        .catch(() => {})
      await closeWithEscape(admin)
    })

    await capture('step-up-dialog.png', async () => {
      // Step-up only asks again once the session is older than 10 minutes.
      const elapsed = Date.now() - loginAt
      const wait = 10.5 * 60_000 - elapsed
      if (wait > 0) await admin.waitForTimeout(wait)
      await goToSite(
        admin,
        harborId,
        '/settings?tab=developer',
        admin.getByTestId('settings-developer'),
      )
      await admin.getByTestId('rotate-token').click()
      const confirm = admin
        .getByRole('alertdialog')
        .getByRole('button')
        .filter({ hasText: /rotate/i })
        .last()
      await confirm.click()
      await expect(admin.getByTestId('step-up-dialog')).toBeVisible({
        timeout: 20_000,
      })
      await shot(admin, 'step-up-dialog.png')
      await closeWithEscape(admin)
    })

    await adminContext.close()
    await ownerContext.close()

    expect(failures, failures.join('\n')).toEqual([])
  })
})
