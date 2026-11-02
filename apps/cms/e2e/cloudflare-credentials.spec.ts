import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  E2E_CLOUDFLARE_ACCOUNT_ID,
  E2E_CLOUDFLARE_TOKENS,
} from './cloudflare-stub'
import {
  createAgencyClient,
  expectToast,
  hydrated,
  login,
  uniqueSuffix,
} from './helpers'

/*
 * Cloudflare credentials on a client's Deployment tab, against the Cloudflare
 * stub from global-setup.ts (the dev server reaches it through
 * CLOUDFLARE_API_BASE_URL). The seeded admin has no two-factor, so the save
 * and remove actions skip step-up here.
 */

async function openDeploymentTab(page: Page, name: string) {
  await login(page)
  await createAgencyClient(page, name)
  await page.getByTestId('client-tab-deployment').click()
  await expect(page.getByTestId('cloudflare-card')).toBeVisible()
  await hydrated(page, page.getByTestId('cloudflare-card'))
}

async function fillConnection(page: Page, token?: string) {
  await page
    .getByTestId('cloudflare-account-id')
    .fill(E2E_CLOUDFLARE_ACCOUNT_ID)
  if (token) await page.getByTestId('cloudflare-api-token').fill(token)
  await page.getByTestId('cloudflare-save').click()
}

function check(page: Page, name: string) {
  return page.getByTestId(`cloudflare-check-${name}`)
}

test.describe('Cloudflare credentials', () => {
  test('the setup guide lists the permissions and links to Cloudflare', async ({
    page,
  }) => {
    await openDeploymentTab(page, `E2E Cloudflare guide ${uniqueSuffix()}`)

    await page.getByTestId('cloudflare-guide-open').click()
    const guide = page.getByTestId('cloudflare-guide')
    await expect(guide).toBeVisible()

    const permissions = guide.getByTestId('cloudflare-guide-permissions')
    await expect(permissions).toContainText('Account › Cloudflare Pages › Edit')
    await expect(permissions).toContainText('Account › Workers Scripts › Read')
    await expect(permissions).toContainText('Account › Workers Builds Configuration › Edit')
    await expect(
      guide.getByTestId('cloudflare-guide-steps').locator(':scope > li'),
    ).toHaveCount(9)
    await expect(
      guide.getByTestId('cloudflare-guide-token-link'),
    ).toHaveAttribute('href', 'https://dash.cloudflare.com/profile/api-tokens')
    await expect(
      guide.getByTestId('cloudflare-guide-docs-link'),
    ).toHaveAttribute(
      'href',
      'https://developers.cloudflare.com/fundamentals/api/get-started/create-token/',
    )
  })

  test('saving a full-access token shows green checks and never exposes the token', async ({
    page,
  }) => {
    const token = E2E_CLOUDFLARE_TOKENS.full
    const serverBodies: Promise<string>[] = []
    page.on('response', (response) => {
      if (!response.url().includes('/_serverFn/')) return
      serverBodies.push(response.text().catch(() => ''))
    })

    await openDeploymentTab(page, `E2E Cloudflare save ${uniqueSuffix()}`)
    await fillConnection(page, token)
    await expectToast(page, 'Cloudflare credentials saved and checked')

    await expect(page.getByTestId('cloudflare-status')).toContainText(
      'Connected',
    )
    for (const name of ['token', 'pages', 'workers-scripts', 'workers-ci']) {
      await expect(check(page, name)).toHaveAttribute('data-state', 'pass')
    }
    await expect(page.getByTestId('cloudflare-account-id')).toHaveValue(
      E2E_CLOUDFLARE_ACCOUNT_ID,
    )

    // The token field is write-only: empty, with the last four characters
    // as the placeholder.
    const tokenInput = page.getByTestId('cloudflare-api-token')
    await expect(tokenInput).toHaveValue('')
    await expect(tokenInput).toHaveAttribute('placeholder', '•••• 0001')
    await expect(tokenInput).toHaveAttribute('autocomplete', 'off')

    await expect(page.getByTestId('cloudflare-saved-by')).toBeVisible()
    await expect(page.getByTestId('cloudflare-last-verified')).toContainText(
      /./,
    )

    // A reload shows the same connection without the token anywhere.
    await page.reload()
    await page.getByTestId('client-tab-deployment').click()
    await expect(page.getByTestId('cloudflare-status')).toContainText(
      'Connected',
    )
    await expect(check(page, 'pages')).toHaveAttribute('data-state', 'pass')
    await expect(page.getByTestId('cloudflare-api-token')).toHaveValue('')
    expect(await page.content()).not.toContain(token)
    const bodies = await Promise.all(serverBodies)
    for (const body of bodies) expect(body).not.toContain(token)
  })

  test('a failing permission is saved and reported; verify keeps the report', async ({
    page,
  }) => {
    await openDeploymentTab(page, `E2E Cloudflare partial ${uniqueSuffix()}`)
    await fillConnection(page, E2E_CLOUDFLARE_TOKENS.noPages)
    await expectToast(page, 'Saved, but some checks failed')

    // The token itself is fine, so the connection is saved.
    await expect(page.getByTestId('cloudflare-status')).toContainText(
      'Connected',
    )
    await expect(check(page, 'token')).toHaveAttribute('data-state', 'pass')
    await expect(check(page, 'pages')).toHaveAttribute('data-state', 'fail')
    await expect(check(page, 'pages')).toContainText('Authentication error')
    await expect(check(page, 'workers-scripts')).toHaveAttribute(
      'data-state',
      'pass',
    )

    await page.getByTestId('cloudflare-verify').click()
    await expect(check(page, 'pages')).toHaveAttribute('data-state', 'fail')
    await expect(check(page, 'pages')).toContainText('Authentication error')
  })

  test('a disabled token is refused and nothing is stored', async ({
    page,
  }) => {
    await openDeploymentTab(page, `E2E Cloudflare refused ${uniqueSuffix()}`)
    await fillConnection(page, E2E_CLOUDFLARE_TOKENS.disabled)

    await expect(page.getByTestId('cloudflare-error')).toContainText(
      'The token is disabled in Cloudflare',
    )
    await expect(page.getByTestId('cloudflare-status')).toContainText(
      'Not connected',
    )
    await expect(page.getByTestId('cloudflare-verify')).toBeDisabled()
    await expect(page.getByTestId('cloudflare-checks')).toHaveCount(0)
  })

  test('removing the credentials asks first and disconnects', async ({
    page,
  }) => {
    await openDeploymentTab(page, `E2E Cloudflare remove ${uniqueSuffix()}`)
    await fillConnection(page, E2E_CLOUDFLARE_TOKENS.full)
    await expectToast(page, 'Cloudflare credentials saved and checked')
    await expect(page.getByTestId('cloudflare-status')).toContainText(
      'Connected',
    )

    await page.getByTestId('cloudflare-remove').click()
    const dialog = page.getByTestId('cloudflare-remove-confirm')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Remove Cloudflare credentials?')
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click()

    await expectToast(page, 'Cloudflare credentials removed')
    await expect(page.getByTestId('cloudflare-status')).toContainText(
      'Not connected',
    )
    await expect(page.getByTestId('cloudflare-remove')).toHaveCount(0)
  })
})
