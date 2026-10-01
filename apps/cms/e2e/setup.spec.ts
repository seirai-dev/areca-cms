import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { expect, test } from '@playwright/test'

import { ADMIN, PASSWORD, authForm, signOut } from './helpers'

const cmsRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Runs a CMS script against the same DATABASE_URL/S3_BUCKET as the server. */
function runCmsScript(script: string) {
  execSync(`pnpm -s ${script}`, {
    cwd: cmsRoot,
    stdio: 'inherit',
    env: process.env,
  })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  runCmsScript('db:reset')
})

test.afterAll(() => {
  // Every other spec starts from the seed (admin, Acme owner/editor, acme-site).
  runCmsScript('db:reset')
  runCmsScript('db:seed')
})

test('an empty CMS welcomes the first admin and lands in the Agency checklist', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup/)
  const form = await authForm(page)
  await expect(
    page.getByRole('heading', { name: /^Welcome to / }),
  ).toBeVisible()
  await expect(page.getByText('Create the first admin account.')).toBeVisible()

  await page.getByLabel('Name').fill('Agency Admin')
  await page.getByLabel('Email').fill(ADMIN)
  const password = page.getByLabel('Password')
  await password.fill(PASSWORD)
  // The eye toggles the password's visibility.
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByTestId('password-visibility').click()
  await expect(password).toHaveAttribute('type', 'text')
  await form.getByRole('button', { name: 'Create admin account' }).click()

  // No sites yet, so the resolver sends the admin to the Agency workspace.
  await expect(page).toHaveURL(/\/agency$/)
  const checklist = page.getByTestId('get-started')
  await expect(checklist).toBeVisible()
  await expect(checklist).toContainText('Get your agency ready')
  await expect(page.getByTestId('get-started-client')).toHaveAttribute(
    'data-done',
    'false',
  )
  for (const step of ['site', 'connect', 'invite', 'live']) {
    await expect(page.getByTestId(`get-started-${step}`)).toHaveAttribute(
      'data-done',
      'false',
    )
  }
  // The first step's action opens the New client sheet.
  await page.getByTestId('get-started-client-action').click()
  await expect(page.getByTestId('new-client-sheet')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('new-client-sheet')).toBeHidden()

  // Setup is one-time: signed in, it sends you back into the app.
  await page.goto('/setup')
  await expect(page).not.toHaveURL(/\/setup/)
  await expect(page.getByTestId('sidebar')).toBeVisible()

  await signOut(page)
})

test('a signed-out visit to /setup redirects to /login once an admin exists', async ({
  page,
}) => {
  await page.goto('/setup')
  await expect(page).toHaveURL(/\/login/)
  await authForm(page)
})
