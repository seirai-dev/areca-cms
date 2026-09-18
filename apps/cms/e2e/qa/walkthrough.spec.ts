import { execSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'

import {
  datetimeLocalMinutesAgo,
  issues,
  logIssue,
  openAcmeSite,
  QA_PASSWORD,
  QA_PNG,
  readDemoSiteToken,
  REPO_ROOT,
  screenshot,
  qaLogin,
  waitForInviteLink,
  waitForSavedDraft,
  writeIssues,
} from './helpers'

test.describe.configure({ mode: 'serial' })

const state = {
  siteToken: '',
  siteId: '',
  orgId: '',
  previewUrl: '',
  welcomeSlug: 'welcome-to-acme',
}

test.afterAll(() => {
  writeIssues()
})

async function acceptInvite(
  browser: Browser,
  email: string,
  name: string,
  inviteUrl: string,
) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(inviteUrl)
  await expect(page.getByRole('heading', { name: 'Invitation' })).toBeVisible()
  await expect(page.getByLabel('Name')).toBeVisible({ timeout: 15_000 })
  await screenshot(page, `invite-${email.split('@')[0]}`)
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Password').fill(QA_PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible({
    timeout: 15_000,
  })
  await screenshot(page, `invite-accept-${email.split('@')[0]}`)
  await page.getByRole('button', { name: 'Accept' }).click()
  await expect(page).toHaveURL('/', { timeout: 15_000 })
  await screenshot(page, `dashboard-${email.split('@')[0]}`)
  return { context, page }
}

async function fillRichText(page: Page) {
  const editor = page.getByTestId('rich-text-editor')
  await editor.click()
  await page.keyboard.type('Welcome paragraph with a boldword')
  await page.keyboard.press('Control+Shift+ArrowLeft')
  await page.getByRole('button', { name: 'Bold' }).click()
  await expect(editor.locator('strong')).toContainText('boldword')
  await page.keyboard.press('End')
  await page.keyboard.type(' here.')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Heading 2' }).click()
  await page.keyboard.type('A section heading')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Bullet list' }).click()
  await page.keyboard.type('First bullet')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Second bullet')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Visit Acme')
  await page.keyboard.press('Control+Shift+ArrowLeft')
  page.once('dialog', (dialog) => {
    void dialog.accept('https://example.com')
  })
  await page.getByRole('button', { name: 'Link' }).click()
  await expect(editor.locator('a[href="https://example.com"]')).toContainText(
    'Acme',
  )
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Image' }).click()
  await expect(page.getByTestId('media-picker')).toBeVisible()
  await page
    .getByTestId('media-picker')
    .getByTestId('media-upload')
    .setInputFiles({
      name: 'body-inline.png',
      mimeType: 'image/png',
      buffer: QA_PNG,
    })
  await expect(page.getByTestId('media-picker')).toBeHidden({ timeout: 15_000 })
  await expect(editor.locator('img')).toHaveCount(1, { timeout: 15_000 })
}

test('01 setup, get started, sign out and back in', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('http://localhost:3000')
  await expect(page).toHaveURL(/\/setup/, { timeout: 15_000 })
  await expect(
    page.getByRole('heading', { name: 'Set up Areca' }),
  ).toBeVisible()
  await screenshot(page, 'setup')

  await expect(page.locator('form[data-ready="true"]')).toBeVisible()
  await page.getByLabel('Name').fill('Agency Admin')
  await page.getByLabel('Email').fill('qa-admin@areca.local')
  await page.getByLabel('Password').fill(QA_PASSWORD)
  await page
    .locator('form[data-ready="true"]')
    .getByRole('button', { name: 'Create admin account' })
    .click()

  await expect(page).toHaveURL('/', { timeout: 15_000 })
  await expect(page.getByTestId('get-started')).toBeVisible()
  await screenshot(page, 'dashboard-get-started')

  await page.goto('/setup')
  await expect(page).toHaveURL('/', { timeout: 15_000 })
  await screenshot(page, 'setup-signed-in-redirect')

  await expect(page.getByTestId('sign-out')).toBeEnabled()
  await page.getByTestId('sign-out').click()
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  await screenshot(page, 'signed-out')

  await page.goto('/setup')
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  await screenshot(page, 'setup-redirect-login')

  await qaLogin(page, 'qa-admin@areca.local')
  await expect(page.getByTestId('get-started')).toBeVisible()
  await screenshot(page, 'signed-in-again')
})

test('02 create org, site, invites, role dashboards, admin lists', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000)
  await qaLogin(page, 'qa-admin@areca.local')
  await page.goto('/admin/organizations')
  await expect(
    page.getByRole('heading', { name: 'Organizations' }),
  ).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByTestId('organizations-page')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 15_000 },
  )
  await screenshot(page, 'organizations-empty')

  await page.getByTestId('new-organization').click()
  await page.getByTestId('org-name').fill('Acme')
  await expect(page.getByTestId('org-slug')).toHaveValue('acme')
  await screenshot(page, 'new-organization-dialog')
  await page.getByRole('button', { name: 'Create organization' }).click()
  await expect(page).toHaveURL(/\/admin\/organizations\/[^/]+$/, {
    timeout: 15_000,
  })
  state.orgId = page.url().split('/').pop() ?? ''
  await expect(page.getByRole('heading', { name: 'Acme' })).toBeVisible()
  await screenshot(page, 'org-acme')

  await page.getByTestId('new-site').click()
  await page.getByTestId('site-name').fill('Acme Site')
  await expect(page.getByTestId('site-slug')).toHaveValue('acme-site')
  await expect(page.getByTestId('site-production-url')).toHaveValue(
    'http://localhost:3001',
  )
  await screenshot(page, 'new-site-dialog')
  await page.getByRole('button', { name: 'Create site' }).click()
  const tokenAlert = page.getByTestId('site-token-alert')
  await expect(tokenAlert).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'New site' })).toHaveCount(0, {
    timeout: 15_000,
  })
  state.siteToken = (
    await page.getByTestId('site-token-value').innerText()
  ).trim()
  expect(state.siteToken).toBeTruthy()
  await screenshot(page, 'site-token-once')

  await page.getByRole('tab', { name: 'Members' }).click()
  await expect(page.getByTestId('invite-member')).toBeVisible()
  await screenshot(page, 'org-members-empty')

  async function invite(email: string, role: 'owner' | 'editor') {
    await page.getByRole('tab', { name: 'Members' }).click()
    await expect(page.getByTestId('pending-invitations')).toBeVisible()
    await page.getByTestId('invite-member').click()
    await expect(page.getByTestId('invite-email')).toBeVisible({
      timeout: 15_000,
    })
    await page.getByTestId('invite-email').fill(email)
    await page.locator('#invite-role').click()
    await page.getByRole('listbox').waitFor()
    await page.getByRole('option', { name: role, exact: true }).click()
    await page.getByRole('button', { name: 'Send invitation' }).click()
    await expect(page.getByText('Invitation sent')).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page.getByTestId('pending-invitations').getByText(email),
    ).toBeVisible()
  }

  await invite('qa-owner@example.com', 'owner')
  await invite('qa-editor@example.com', 'editor')
  await screenshot(page, 'pending-invitations')

  const ownerLink = await waitForInviteLink('qa-owner@example.com')
  const editorLink = await waitForInviteLink('qa-editor@example.com')

  const owner = await acceptInvite(
    browser,
    'qa-owner@example.com',
    'QA Owner',
    ownerLink,
  )
  await expect(
    owner.page
      .getByTestId('sites-nav')
      .getByRole('link', { name: /Acme Site/ }),
  ).toBeVisible()
  await expect(owner.page.getByTestId('agency-nav')).toHaveCount(0)
  await owner.page
    .getByTestId('sites-nav')
    .getByRole('link', { name: /Acme Site/ })
    .click()
  await expect(owner.page.getByTestId('team-nav')).toBeVisible()
  await expect(owner.page.getByRole('link', { name: 'Settings' })).toHaveCount(
    0,
  )
  await expect(owner.page.getByTestId('site-content')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await screenshot(owner.page, 'owner-site-nav')

  const editor = await acceptInvite(
    browser,
    'qa-editor@example.com',
    'QA Editor',
    editorLink,
  )
  await expect(
    editor.page
      .getByTestId('sites-nav')
      .getByRole('link', { name: /Acme Site/ }),
  ).toBeVisible()
  await expect(editor.page.getByTestId('agency-nav')).toHaveCount(0)
  await editor.page
    .getByTestId('sites-nav')
    .getByRole('link', { name: /Acme Site/ })
    .click()
  await expect(editor.page.getByTestId('team-nav')).toHaveCount(0)
  await expect(editor.page.getByRole('link', { name: 'Settings' })).toHaveCount(
    0,
  )
  await expect(editor.page.getByTestId('site-content')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await screenshot(editor.page, 'editor-site-nav')

  await owner.context.close()
  await editor.context.close()

  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
  await expect(
    page.getByRole('cell', { name: 'qa-admin@areca.local', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('cell', { name: 'qa-owner@example.com', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('cell', { name: 'qa-editor@example.com', exact: true }),
  ).toBeVisible()
  await screenshot(page, 'admin-users')

  await page.goto('/admin/audit')
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible()
  await expect(
    page.getByRole('cell', { name: 'Agency Admin' }).first(),
  ).toBeVisible()
  const auditText = await page.locator('table').innerText()
  if (
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(
      auditText,
    )
  ) {
    logIssue({
      area: 'audit',
      severity: 'visual',
      note: 'Audit table shows raw UUIDs where a human label is expected',
    })
  }
  if (!/create|invite|accept/i.test(auditText)) {
    logIssue({
      area: 'audit',
      severity: 'functional',
      note: 'Audit log missing expected create/invite/accept actions',
    })
  }
  await screenshot(page, 'admin-audit')
})

test('03 sync demo-site manifest and inspect collection fields', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await qaLogin(page, 'qa-admin@areca.local')
  writeFileSync(
    join(REPO_ROOT, 'examples', 'demo-site', '.env.local'),
    `ARECA_CMS_URL=http://localhost:3000\nARECA_SITE_TOKEN=${state.siteToken}\n`,
  )
  execSync('pnpm --filter @areca/demo-site sync-manifest', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })

  await page.goto('/')
  await openAcmeSite(page)
  state.siteId = page.url().match(/\/sites\/([^/]+)/)?.[1] ?? ''
  await page
    .getByTestId('site-nav')
    .getByRole('link', { name: 'Settings' })
    .click()
  await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible()
  await expect(
    page.getByRole('cell', { name: 'articles', exact: true }),
  ).toBeVisible({
    timeout: 15_000,
  })
  await expect(
    page.getByRole('cell', { name: 'Articles', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('cell', { name: '/blog/$slug' })).toBeVisible()
  await screenshot(page, 'site-settings-collections')

  await page.getByRole('button', { name: 'Edit' }).click()
  await expect(
    page.getByRole('heading', { name: 'Edit collection' }),
  ).toBeVisible()
  await expect(page.getByTestId('collection-key')).toHaveValue('articles')
  await expect(page.getByTestId('field-row-0')).toHaveAttribute(
    'data-locked',
    'true',
  )
  await expect(page.getByTestId('field-key-0')).toHaveText('slug')
  await expect(page.getByTestId('field-key-1')).toHaveValue('title')
  await expect(page.getByTestId('field-label-1')).toHaveValue('Title')
  await expect(page.getByTestId('field-key-2')).toHaveValue('excerpt')
  await expect(page.getByTestId('field-key-3')).toHaveValue('body')
  await expect(page.getByTestId('field-key-4')).toHaveValue('heroImage')
  await expect(page.getByTestId('field-key-6')).toHaveValue('category')
  await page.getByTestId('field-key-6').scrollIntoViewIfNeeded()
  await screenshot(page, 'collection-editor-dialog')
  await page.keyboard.press('Escape')
})

test('04 editor authors articles, persistence, revisions, validation', async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const context = await browser.newContext()
  const page = await context.newPage()
  await qaLogin(page, 'qa-editor@example.com')
  await openAcmeSite(page)
  await screenshot(page, 'editor-site-dashboard')

  await page
    .getByTestId('collection-articles')
    .getByRole('link', { name: 'Open' })
    .click()
  await screenshot(page, 'articles-empty')
  await page.getByTestId('new-entry').click()
  await expect(page.getByTestId('entry-editor')).toBeVisible()
  await screenshot(page, 'new-article-empty')

  await page.getByLabel(/Title/).fill('Welcome to Acme')
  await expect(page.getByLabel(/Slug/)).toHaveValue('welcome-to-acme')
  await page.getByLabel(/Excerpt/).fill('A short excerpt for the welcome post.')
  await page.locator('#field-category').click()
  await page.getByRole('option', { name: 'news' }).click()
  await page.locator('#field-publishedAt').fill('2026-09-01T10:00')

  await page.getByRole('button', { name: 'Choose' }).click()
  await expect(page.getByTestId('media-picker')).toBeVisible()
  await page.getByTestId('media-upload').setInputFiles({
    name: 'hero.png',
    mimeType: 'image/png',
    buffer: QA_PNG,
  })
  await expect(page.getByTestId('image-field-thumb')).toBeVisible({
    timeout: 15_000,
  })

  await fillRichText(page)
  const filledBody = page.getByTestId('rich-text-editor')
  await expect(filledBody.locator('strong')).toContainText('boldword')
  await expect(filledBody.locator('h2')).toHaveText('A section heading')
  await expect(filledBody.locator('ul')).toContainText('First bullet')
  await expect(
    filledBody.locator('a[href="https://example.com"]'),
  ).toContainText('Acme')
  await expect(filledBody.locator('img')).toHaveCount(1)
  await screenshot(page, 'article-filled')

  await page.getByTestId('save-draft').click()
  await waitForSavedDraft(page)
  await screenshot(page, 'article-saved')

  await page.reload()
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 15_000 },
  )
  await expect(page.getByLabel(/Title/)).toHaveValue('Welcome to Acme')
  await expect(page.getByLabel(/Slug/)).toHaveValue('welcome-to-acme')
  await expect(page.getByLabel(/Excerpt/)).toHaveValue(
    'A short excerpt for the welcome post.',
  )
  await expect(page.locator('#field-category')).toContainText('news')
  await expect(page.locator('#field-publishedAt')).toHaveValue(
    '2026-09-01T10:00',
  )
  await expect(page.getByTestId('image-field-thumb')).toBeVisible()
  const body = page.getByTestId('rich-text-editor')
  await expect(body.locator('strong')).toContainText('boldword')
  await expect(body.locator('h2')).toHaveText('A section heading')
  await expect(body.locator('ul')).toContainText('First bullet')
  await expect(body.locator('a[href="https://example.com"]')).toBeVisible()
  await expect(body.locator('img')).toHaveCount(1)
  await screenshot(page, 'article-reloaded')

  await page.getByRole('link', { name: 'Back to Articles' }).click()
  await expect(
    page.getByRole('link', { name: 'Welcome to Acme' }),
  ).toBeVisible()
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible()
  await screenshot(page, 'articles-one-draft')

  async function createQuickArticle(title: string, withHero: boolean) {
    await page.getByTestId('new-entry').click()
    await page.getByLabel(/Title/).fill(title)
    await page.getByTestId('rich-text-editor').click()
    await page.keyboard.type(`Body for ${title}`)
    if (withHero) {
      await page.getByRole('button', { name: 'Choose' }).click()
      await page.getByTestId('media-upload').setInputFiles({
        name: `${title.replace(/\s+/g, '-')}.png`,
        mimeType: 'image/png',
        buffer: QA_PNG,
      })
      await expect(page.getByTestId('image-field-thumb')).toBeVisible({
        timeout: 15_000,
      })
    }
    await page.getByTestId('save-draft').click()
    await waitForSavedDraft(page)
  }

  await createQuickArticle('Shipping the first release', true)
  await page.getByRole('link', { name: 'Back to Articles' }).click()
  await createQuickArticle('How preview works', false)

  await page.getByTestId('publish-menu').click()
  await page.getByTestId('publish-now').click()
  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-status',
    'published',
    { timeout: 15_000 },
  )

  await page.getByRole('link', { name: 'Back to Articles' }).click()
  await page.getByRole('link', { name: 'Shipping the first release' }).click()
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 15_000 },
  )
  await page.getByTestId('publish-menu').click()
  await page.getByTestId('publish-now').click()
  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-status',
    'published',
    { timeout: 15_000 },
  )

  await page.getByRole('link', { name: 'Back to Articles' }).click()
  await screenshot(page, 'articles-mixed-status')

  await page.getByRole('link', { name: 'Welcome to Acme' }).click()
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 15_000 },
  )
  await page.getByRole('tab', { name: 'Revisions' }).click()
  await screenshot(page, 'revisions-panel')
  const restoreButtons = page.getByRole('button', { name: 'Restore' })
  await expect(restoreButtons.first()).toBeVisible()

  await page.getByRole('tab', { name: 'Fields' }).click()
  await page.getByLabel(/Title/).fill('Welcome to Acme edited')
  await page.getByTestId('save-draft').click()
  await waitForSavedDraft(page)
  await page.getByRole('tab', { name: 'Revisions' }).click()
  await page.getByRole('button', { name: 'Restore' }).nth(1).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Restore' })
    .click()
  await expect(page.getByText('Revision restored')).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('tab', { name: 'Fields' }).click()
  await expect(page.getByLabel(/Title/)).toHaveValue('Welcome to Acme')
  await screenshot(page, 'revision-restored')

  await page.getByLabel(/Title/).fill('')
  await page.getByTestId('save-draft').click()
  await expect(
    page.getByRole('alert').filter({ hasText: /required/i }),
  ).toBeVisible({
    timeout: 10_000,
  })
  await screenshot(page, 'validation-empty-title')

  await page.getByLabel(/Title/).fill('Welcome to Acme')
  await page.getByLabel(/Slug/).fill('Hello World')
  await page.getByTestId('save-draft').click()
  await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 10_000 })
  await screenshot(page, 'validation-bad-slug')
  await page.getByLabel(/Slug/).fill('welcome-to-acme')
  await page.getByTestId('save-draft').click()
  await waitForSavedDraft(page)

  await page.getByRole('link', { name: 'Back to Articles' }).click()
  await page.getByTestId('new-entry').click()
  await page.getByLabel(/Title/).fill('Empty body draft')
  await page.getByTestId('save-draft').click()
  await waitForSavedDraft(page)
  await page.getByTestId('publish-menu').click()
  await page.getByTestId('publish-now').click()
  await expect(
    page.getByRole('alert').filter({ hasText: /Required|Could not publish/i }),
  ).toBeVisible({ timeout: 15_000 })
  await screenshot(page, 'validation-empty-body-publish')

  await context.close()
})

test('05 schedule past draft and wait for worker', async ({ browser }) => {
  test.setTimeout(180_000)
  const context = await browser.newContext()
  const page = await context.newPage()
  await qaLogin(page, 'qa-editor@example.com')
  await openAcmeSite(page)
  await page
    .getByTestId('collection-articles')
    .getByRole('link', { name: 'Open' })
    .click()
  await page.getByRole('link', { name: 'Welcome to Acme' }).click()
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 15_000 },
  )

  await page.getByTestId('publish-menu').click()
  await page.getByTestId('schedule-entry').click()
  await page.getByTestId('schedule-at').fill(datetimeLocalMinutesAgo(1))
  await screenshot(page, 'schedule-dialog')
  await page.getByTestId('schedule-confirm').click()
  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-status',
    'scheduled',
    { timeout: 15_000 },
  )
  await screenshot(page, 'entry-scheduled')

  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-status',
    'published',
    { timeout: 25_000 },
  )
  await page
    .getByTestId('site-nav')
    .getByRole('link', { name: 'Content' })
    .click()
  await expect(page.getByTestId('release-live')).toBeVisible({
    timeout: 30_000,
  })
  await screenshot(page, 'status-bar-after-schedule')
  await page
    .getByTestId('site-nav')
    .getByRole('link', { name: 'Releases' })
    .click()
  await expect(page.getByTestId('publication-status-live')).toBeVisible({
    timeout: 15_000,
  })
  await screenshot(page, 'releases-after-schedule')
  await context.close()
})

test('06 preview URL shape on a new draft', async ({ browser }) => {
  test.setTimeout(90_000)
  const context = await browser.newContext()
  const page = await context.newPage()
  await qaLogin(page, 'qa-editor@example.com')
  await openAcmeSite(page)
  await page
    .getByTestId('collection-articles')
    .getByRole('link', { name: 'Open' })
    .click()
  await page.getByTestId('new-entry').click()
  await page.getByLabel(/Title/).fill('Preview only draft')
  await page.getByTestId('rich-text-editor').click()
  await page.keyboard.type('Draft body for preview.')
  await page.getByTestId('save-draft').click()
  await waitForSavedDraft(page)

  const preview = page.getByTestId('preview-entry')
  await expect(preview).toHaveAttribute('href', /[?&]token=/, {
    timeout: 15_000,
  })
  const href = (await preview.getAttribute('href')) ?? ''
  expect(href).toMatch(
    /^http:\/\/localhost:3001\/__preview\/articles\/preview-only-draft\?token=/,
  )
  state.previewUrl = href
  await screenshot(page, 'preview-button')
  await context.close()
})

test('07 publish site, logs, rollback as owner', async ({ browser }) => {
  test.setTimeout(180_000)
  const context = await browser.newContext()
  const page = await context.newPage()
  await qaLogin(page, 'qa-owner@example.com')
  await openAcmeSite(page)
  await page.getByTestId('publish-site').click()
  await expect(page.getByText('Publish requested')).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByTestId('release-live')).toBeVisible({
    timeout: 30_000,
  })
  await screenshot(page, 'owner-live-status')

  await page
    .getByTestId('site-nav')
    .getByRole('link', { name: 'Releases' })
    .click()
  await expect(page.getByTestId('publication-status-live')).toBeVisible()
  const releasesText = await page
    .locator('main, [class*="grid"]')
    .first()
    .innerText()
  if (
    /\b[0-9a-f]{8}-[0-9a-f]{4}-/.test(releasesText) &&
    !/QA Owner|Agency Admin/i.test(releasesText)
  ) {
    logIssue({
      area: 'releases',
      severity: 'visual',
      note: 'Requested by looks like a raw id instead of a person name',
    })
  }
  await screenshot(page, 'releases-live')

  await page.getByRole('button', { name: 'Logs' }).first().click()
  await expect(page.getByRole('heading', { name: 'Build logs' })).toBeVisible()
  await expect(page.locator('pre')).toContainText(
    /no deployment target|live|succeeded/i,
  )
  await screenshot(page, 'build-logs')
  await page.keyboard.press('Escape')

  await page
    .getByTestId('site-nav')
    .getByRole('link', { name: 'Content' })
    .click()
  await page.getByTestId('publish-site').click()
  await expect(page.getByTestId('release-live')).toBeVisible({
    timeout: 30_000,
  })
  await page
    .getByTestId('site-nav')
    .getByRole('link', { name: 'Releases' })
    .click()
  await expect(page.getByTestId('publication-status-superseded')).toBeVisible({
    timeout: 30_000,
  })
  await screenshot(page, 'releases-superseded')

  await page.getByTestId('publication-menu').click()
  await page.getByTestId('rollback-publication').click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Rollback' })
    .click()
  await expect(page.getByText('Rollback requested')).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByTestId('publication-status-live')).toHaveCount(1, {
    timeout: 30_000,
  })
  await screenshot(page, 'releases-after-rollback')
  await context.close()
})

test('08 media library alt persist, in-use and unused delete', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const context = await browser.newContext()
  const page = await context.newPage()
  await qaLogin(page, 'qa-editor@example.com')
  await openAcmeSite(page)
  await page
    .getByTestId('site-nav')
    .getByRole('link', { name: 'Media' })
    .click()
  await screenshot(page, 'media-library')

  const firstAlt = page.locator('input[placeholder="Alt text"]').first()
  await firstAlt.fill('Welcome hero')
  await firstAlt.blur()
  await expect(page.getByText('Alt text saved')).toBeVisible({
    timeout: 15_000,
  })
  await page.reload()
  await expect(
    page.locator('input[placeholder="Alt text"]').first(),
  ).toHaveValue('Welcome hero')
  await screenshot(page, 'media-alt-persisted')

  await page.getByRole('button', { name: 'Upload' }).click()
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles({
    name: 'unused-qa-2.png',
    mimeType: 'image/png',
    buffer: QA_PNG,
  })
  await expect(page.getByText('unused-qa-2.png')).toBeVisible({
    timeout: 15_000,
  })

  const mediaCard = (filename: string) =>
    page.locator('p').filter({ hasText: filename }).locator('xpath=..')

  const heroCard = mediaCard('hero.png')
  if (await heroCard.count()) {
    await heroCard.getByRole('button', { name: 'Delete' }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click()
    await expect(page.getByText(/in use/i)).toBeVisible({ timeout: 15_000 })
    await screenshot(page, 'media-in-use-error')
  } else {
    logIssue({
      area: 'media',
      severity: 'functional',
      note: 'Could not find hero.png card to test in-use delete',
    })
  }

  await mediaCard('unused-qa-2.png')
    .getByRole('button', { name: 'Delete' })
    .click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(page.getByText('Deleted')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('unused-qa-2.png')).toHaveCount(0)
  await screenshot(page, 'media-after-unused-delete')
  await context.close()
})

test('09 demo site pull, pages, preview, health', async ({ browser }) => {
  test.setTimeout(180_000)
  if (!state.previewUrl) {
    const recover = await browser.newContext()
    const recoverPage = await recover.newPage()
    await qaLogin(recoverPage, 'qa-editor@example.com')
    await openAcmeSite(recoverPage)
    await recoverPage
      .getByTestId('collection-articles')
      .getByRole('link', { name: 'Open' })
      .click()
    await recoverPage.getByRole('link', { name: 'Preview only draft' }).click()
    await expect(recoverPage.getByTestId('entry-editor')).toHaveAttribute(
      'data-ready',
      'true',
      { timeout: 15_000 },
    )
    const href = await recoverPage
      .getByTestId('preview-entry')
      .getAttribute('href')
    state.previewUrl = href ?? ''
    await recover.close()
  }
  execSync('pnpm --filter @areca/demo-site content:pull', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })

  let demo: ChildProcess | undefined
  try {
    demo = spawn('pnpm', ['--filter', '@areca/demo-site', 'dev'], {
      cwd: REPO_ROOT,
      shell: true,
      stdio: 'pipe',
    })
    const ready = Date.now() + 60_000
    let up = false
    while (Date.now() < ready) {
      try {
        const res = await fetch('http://localhost:3001/api/health')
        if (res.ok) {
          up = true
          break
        }
      } catch {
        /* still starting */
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    if (!up) throw new Error('demo-site did not start on :3001')

    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('http://localhost:3001')
    await expect(
      page.getByRole('heading', { name: /Build once/i }),
    ).toBeVisible()
    await screenshot(page, 'demo-home')

    await page.goto('http://localhost:3001/blog')
    await expect(page.getByRole('heading', { name: 'Blog' })).toBeVisible()
    await expect(page.getByText('Welcome to Acme')).toBeVisible()
    await expect(page.getByText('Shipping the first release')).toBeVisible()
    await expect(page.getByText('Preview only draft')).toHaveCount(0)
    await screenshot(page, 'demo-blog')

    await page.goto('http://localhost:3001/blog/welcome-to-acme')
    await expect(
      page.getByRole('heading', { name: 'Welcome to Acme' }),
    ).toBeVisible()
    await screenshot(page, 'demo-article')

    const health = await fetch('http://localhost:3001/api/health')
    const healthBody = (await health.json()) as { publicationId?: string }
    expect(health.ok).toBeTruthy()
    expect(healthBody.publicationId).toBeTruthy()

    const previewRes = await page.request.get(state.previewUrl)
    const robots = previewRes.headers()['x-robots-tag'] as string | undefined
    if (!robots?.includes('noindex')) {
      logIssue({
        area: 'preview',
        severity: 'functional',
        note: `Preview missing X-Robots-Tag noindex (got ${robots ?? 'none'})`,
      })
    }
    await page.goto(state.previewUrl)
    await expect(page.getByText('PREVIEW - draft content')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText('Preview only draft')).toBeVisible()
    await screenshot(page, 'demo-preview-draft')
    await context.close()
  } finally {
    if (demo?.pid) {
      try {
        execSync(`taskkill /PID ${demo.pid} /T /F`, { stdio: 'ignore' })
      } catch {
        demo.kill()
      }
    }
  }
})

test('10 agency housekeeping, token rotate, danger zone, responsive', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000)
  await qaLogin(page, 'qa-admin@areca.local')
  if (!state.orgId) {
    await page.goto('/admin/organizations')
    await page.getByRole('link', { name: 'Acme', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/organizations\/[^/]+$/)
    state.orgId = page.url().split('/').pop() ?? ''
  }
  await openAcmeSite(page)
  state.siteId = state.siteId || page.url().match(/\/sites\/([^/]+)/)?.[1] || ''
  await page
    .getByTestId('site-nav')
    .getByRole('link', { name: 'Settings' })
    .click()
  await screenshot(page, 'site-settings')

  const oldToken = state.siteToken || readDemoSiteToken()
  await page.getByRole('button', { name: 'Rotate token' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Rotate token' })
    .click()
  await expect(page.getByTestId('site-token-alert')).toBeVisible({
    timeout: 15_000,
  })
  const newToken = (
    await page.getByTestId('site-token-value').innerText()
  ).trim()
  expect(newToken).toBeTruthy()
  expect(newToken).not.toBe(oldToken)
  await screenshot(page, 'token-rotated')

  const denied = await request.get('/api/sites/snapshot/current', {
    headers: { Authorization: `Bearer ${oldToken}` },
  })
  expect(denied.status()).toBe(401)
  const ok = await request.get('/api/sites/snapshot/current', {
    headers: { Authorization: `Bearer ${newToken}` },
  })
  expect(ok.status()).toBe(200)

  await page.getByTestId('application-id').fill('dokploy-app-qa')
  await page
    .getByTestId('health-check-url')
    .fill('http://localhost:3001/api/health')
  await page.getByTestId('save-deployment-target').click()
  await expect(page.getByText('Deployment target updated')).toBeVisible({
    timeout: 15_000,
  })
  await screenshot(page, 'deployment-target-set')
  await page.getByRole('button', { name: 'Clear target' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Clear target' })
    .click()
  await expect(page.getByText('Deployment target updated')).toBeVisible({
    timeout: 15_000,
  })
  await screenshot(page, 'deployment-target-cleared')

  await page.goto(`/admin/organizations/${state.orgId}`)
  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.locator('#rename-org').fill('Acme Agency')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByText('Organization updated')).toBeVisible({
    timeout: 15_000,
  })
  await screenshot(page, 'org-renamed')

  await expect(
    page.getByRole('button', { name: 'Delete organization' }),
  ).toBeDisabled()
  await screenshot(page, 'org-danger-zone-disabled')

  await page.getByRole('tab', { name: 'Sites' }).click()
  await page.getByTestId('new-site').click()
  await page.getByTestId('site-name').fill('Throwaway')
  await page.getByRole('button', { name: 'Create site' }).click()
  await expect(page.getByTestId('site-token-alert')).toBeVisible({
    timeout: 15_000,
  })
  await page
    .getByRole('row')
    .filter({ hasText: 'throwaway' })
    .getByRole('link', { name: 'Settings' })
    .click()
  await page.getByRole('button', { name: 'Delete site' }).click()
  await expect(
    page.getByRole('alertdialog').getByRole('button', { name: 'Delete site' }),
  ).toBeDisabled()
  await screenshot(page, 'delete-site-confirm')
  await page.getByTestId('confirm-text').fill('throwaway')
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete site' })
    .click()
  await expect(page.getByText('Site deleted')).toBeVisible({ timeout: 15_000 })
  await page.goto(`/admin/organizations/${state.orgId}`)
  await expect(page.getByRole('cell', { name: 'throwaway' })).toHaveCount(0)
  await screenshot(page, 'throwaway-gone')

  await page.goto('/')
  await page.setViewportSize({ width: 390, height: 844 })
  await screenshot(page, 'dashboard-390')
  const dashOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 2,
  )
  if (dashOverflow) {
    logIssue({
      area: 'responsive',
      severity: 'visual',
      note: 'Dashboard overflows horizontally at 390px',
    })
  }

  await page.getByRole('button', { name: 'Toggle Sidebar' }).click()
  await screenshot(page, 'dashboard-390-sidebar')

  await page.goto(`/sites/${state.siteId}/c/articles/new`)
  await expect(page.getByTestId('entry-editor')).toBeVisible({
    timeout: 15_000,
  })
  await screenshot(page, 'editor-390')
  const editorOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 2,
  )
  if (editorOverflow) {
    logIssue({
      area: 'responsive',
      severity: 'visual',
      note: 'Entry editor overflows horizontally at 390px',
    })
  }

  console.log('QA issues so far:', JSON.stringify(issues, null, 2))
})
