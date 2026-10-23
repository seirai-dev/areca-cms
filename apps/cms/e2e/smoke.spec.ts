import { expect, test } from '@playwright/test'
import type { ConsoleMessage, Page } from '@playwright/test'

import {
  ACME_SITE,
  ADMIN,
  PASSWORD,
  authForm,
  hydrated,
  openSite,
} from './helpers'

/**
 * Production-build smoke test (the `smoke` project, CI's `smoke` job). It
 * runs against a server started from `.output` on a freshly seeded database,
 * and it never touches the database the `setup` project wipes.
 *
 * Every test fails on a console error or an uncaught exception. Content
 * Security Policy violations are logged as console errors, so this also
 * catches a missing nonce.
 */
function recordErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

test('login page renders without console errors', async ({ page }) => {
  const errors = recordErrors(page)
  await page.goto('/login')
  const form = await authForm(page)
  await expect(form.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await hydrated(page, form)
  expect(errors).toEqual([])
})

test('seeded admin signs in, opens the overview, the library and an entry editor', async ({
  page,
}) => {
  const errors = recordErrors(page)
  await page.goto('/login')
  const form = await authForm(page)
  await page.getByLabel('Email').fill(ADMIN)
  await page.getByLabel('Password').fill(PASSWORD)
  await form.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 })

  await openSite(page, ACME_SITE)
  await expect(page.getByTestId('site-overview')).toBeVisible()

  await page.getByTestId('sidebar').getByTestId('library-nav').click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByTestId('library-page')).toBeVisible()
  await hydrated(page, page.getByTestId('library-page'))

  await page.getByTestId('sidebar').getByTestId('collection-articles').click()
  await expect(page).toHaveURL(/\/c\/articles(?:\?.*)?$/)
  await hydrated(page, page.getByTestId('site-content'))
  await page.getByTestId('new-entry').click()
  await expect(page).toHaveURL(/\/c\/[^/]+\/new$/)
  await expect(page.getByTestId('editor-canvas')).toBeVisible()
  await hydrated(page, page.getByTestId('editor-canvas'))

  expect(errors).toEqual([])
})
