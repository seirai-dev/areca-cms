import { expect, test } from '@playwright/test'
import type { Browser, Locator, Page } from '@playwright/test'

import {
  PASSWORD,
  acceptInvitation,
  authForm,
  createAgencyClient,
  expectToast,
  hydrated,
  inviteToClients,
  login,
  openAgencyPeople,
  openPersonPage,
  slugify,
  uniqueSuffix,
} from './helpers'

/**
 * Agency people (account management): the list's filters, the person page's
 * staged client access, blocking and unblocking, deleting, bulk actions, and
 * inviting a person to several clients. The people share one client set and
 * run in order, so each test builds on the last.
 */
test.describe.configure({ mode: 'serial' })

const suffix = uniqueSuffix()
const clients = {
  a: `E2E Access Alpha ${suffix}`,
  b: `E2E Access Beta ${suffix}`,
  c: `E2E Access Gamma ${suffix}`,
}
const slugs = {
  a: slugify(clients.a),
  b: slugify(clients.b),
  c: slugify(clients.c),
}
const names = {
  jane: 'Jane Tester',
  john: 'John Tester',
  mia: 'Mia Tester',
  sam: 'Sam Tester',
}
const people = {
  pending: `pending+${suffix}@example.com`,
  jane: `jane+${suffix}@example.com`,
  john: `john+${suffix}@example.com`,
  mia: `mia+${suffix}@example.com`,
  sam: `sam+${suffix}@example.com`,
}

/** The role radio inside one access row. */
function roleRadio(page: Page, slug: string, role: 'Owner' | 'Editor') {
  return page
    .getByTestId(`access-role-${slug}`)
    .getByRole('radio', { name: role })
}

/** Signs in as `email` in a fresh browser context; resolves to the page. */
async function signInAs(browser: Browser, email: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/login')
  const form = await authForm(page)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await form.getByRole('button', { name: 'Sign in' }).click()
  return { context, page }
}

async function searchPeople(page: Page, term: string) {
  await openAgencyPeople(page)
  await page.getByRole('searchbox').fill(term)
}

/** A row's checkbox, which selects without opening the person. */
function selectBox(page: Page, email: string): Locator {
  return page.getByTestId(`person-select-${email}`)
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(900_000)
  const context = await browser.newContext()
  const page = await context.newPage()
  await login(page)
  await createAgencyClient(page, clients.a)
  await createAgencyClient(page, clients.b)
  await createAgencyClient(page, clients.c)
  for (const who of ['jane', 'john', 'mia', 'sam'] as const) {
    await inviteToClients(page, people[who], [
      { slug: slugs.a, name: clients.a, role: 'editor' },
    ])
    await acceptInvitation(browser, people[who], names[who])
  }
  await context.close()
})

test('filters the people list by status, with counts and invitations', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await login(page)
  await inviteToClients(page, people.pending, [
    { slug: slugs.a, name: clients.a, role: 'editor' },
  ])

  await searchPeople(page, suffix)
  await expect(page.getByTestId(`person-row-${people.jane}`)).toBeVisible()
  await expect(page.getByTestId(`person-row-${people.jane}`)).toContainText(
    names.jane,
  )

  await page.getByTestId('people-status-filter-invited').click()
  await expect(page).toHaveURL(/status=invited/)
  await expect(
    page.getByTestId(`invitation-row-${people.pending}`),
  ).toBeVisible()
  await expect(page.getByTestId(`person-row-${people.jane}`)).toHaveCount(0)

  await page.getByTestId('people-status-filter-blocked').click()
  await expect(page.getByText('Nothing matches')).toBeVisible()

  await page.getByTestId('people-status-filter-all').click()
  await expect(page.getByTestId(`person-row-${people.jane}`)).toBeVisible()
  await page.getByTestId(`invitation-menu-${people.pending}`).click()
  await expect(page.getByTestId('invitation-resend')).toBeVisible()
  await expect(page.getByTestId('invitation-copy-link')).toBeVisible()
  await expect(page.getByTestId('invitation-revoke')).toBeVisible()
  await page.keyboard.press('Escape')

  // Filters live in the URL, so a reload keeps them.
  await page.getByTestId('people-status-filter-two-factor-off').click()
  await expect(page).toHaveURL(/status=two-factor-off/)
  await page.reload()
  await hydrated(page)
  await expect(
    page.getByTestId('people-status-filter-two-factor-off'),
  ).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId(`person-row-${people.jane}`)).toBeVisible()
})

test('changes a person’s clients: adds two with different roles, changes one, removes one, saves', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await login(page)
  await openPersonPage(page, people.jane)
  await expect(page.getByTestId(`access-row-${slugs.a}`)).toHaveAttribute(
    'data-state',
    'saved',
  )

  /* The picker: search, see the client she already has, pick two. */
  await page.getByTestId('person-add-clients').click()
  await expect(page.getByTestId('client-picker')).toBeVisible()
  await page.getByTestId('client-picker-search').fill('no such client')
  await expect(
    page.getByText('No clients match “no such client”.'),
  ).toBeVisible()
  await page.getByTestId('client-picker-search').fill(clients.a)
  await expect(
    page.getByTestId(`client-picker-option-${slugs.a}`),
  ).toHaveAttribute('data-disabled', 'true')
  await expect(
    page.getByTestId(`client-picker-option-${slugs.a}`),
  ).toContainText('Editor')

  await page.getByTestId('client-picker-search').fill(clients.b)
  await page.getByTestId(`client-picker-option-${slugs.b}`).click()
  await page.getByTestId('client-picker-role-owner').click()
  await expect(page.getByTestId('client-picker-add')).toHaveText('Add 1 client')
  await page.getByTestId('client-picker-add').click()
  await expect(page.getByTestId(`access-row-${slugs.b}`)).toHaveAttribute(
    'data-state',
    'new',
  )

  await page.getByTestId('person-add-clients').click()
  await page.getByTestId('client-picker-search').fill(clients.c)
  await page.getByTestId(`client-picker-option-${slugs.c}`).click()
  await page.getByTestId('client-picker-add').click()
  await expect(page.getByTestId('person-save-summary')).toHaveText('+2 clients')

  /* One save for everything; then reload to see what was stored. */
  await page.getByTestId('person-save').click()
  await expectToast(page, 'Client access saved')
  await page.reload()
  await hydrated(page)
  await expect(roleRadio(page, slugs.b, 'Owner')).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(roleRadio(page, slugs.c, 'Editor')).toHaveAttribute(
    'aria-checked',
    'true',
  )

  /* Change one role, remove one client, and undo the removal once. */
  await roleRadio(page, slugs.a, 'Owner').click()
  await expect(page.getByTestId(`access-row-${slugs.a}`)).toHaveAttribute(
    'data-state',
    'changed',
  )
  await page.getByTestId(`access-remove-${slugs.c}`).click()
  await expect(page.getByTestId(`access-row-${slugs.c}`)).toHaveAttribute(
    'data-state',
    'removed',
  )
  await expect(page.getByTestId('person-save-summary')).toHaveText(
    '1 role change · 1 removal',
  )
  await page.getByTestId(`access-undo-${slugs.c}`).click()
  await expect(page.getByTestId(`access-row-${slugs.c}`)).toHaveAttribute(
    'data-state',
    'saved',
  )
  await page.getByTestId(`access-remove-${slugs.c}`).click()
  await page.getByTestId('person-save').click()
  await expectToast(page, 'Client access saved')

  await page.reload()
  await hydrated(page)
  await expect(page.getByTestId(`access-row-${slugs.c}`)).toHaveCount(0)
  await expect(roleRadio(page, slugs.a, 'Owner')).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(roleRadio(page, slugs.b, 'Owner')).toHaveAttribute(
    'aria-checked',
    'true',
  )
})

test('blocking stops sign-in until the person is unblocked', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000)
  await login(page)
  await openPersonPage(page, people.john)

  await page.getByTestId('person-menu').click()
  await page.getByTestId('person-menu-block').click()
  const dialog = page.getByTestId('person-block-dialog')
  await expect(dialog).toBeVisible()
  await page.getByTestId('person-block-reason').fill('Account review')
  await dialog.getByTestId('confirm-action').click()

  const band = page.getByTestId('person-blocked-band')
  await expect(band).toBeVisible()
  await expect(band).toContainText('Internal note: Account review')

  const blockedSignIn = await signInAs(browser, people.john)
  await expect(
    blockedSignIn.page.getByText(
      'This account is blocked. Contact your agency.',
    ),
  ).toBeVisible()
  await blockedSignIn.context.close()

  await page.getByTestId('person-unblock-band').click()
  await page
    .getByTestId('person-unblock-dialog')
    .getByTestId('confirm-action')
    .click()
  await expectToast(page, `Unblocked ${names.john}`)
  await expect(band).toHaveCount(0)

  const restored = await signInAs(browser, people.john)
  await expect(restored.page).not.toHaveURL(/\/login/, { timeout: 30_000 })
  await restored.context.close()
})

test('deleting a person needs their e-mail typed to confirm', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await login(page)
  await openPersonPage(page, people.mia)

  await page.getByTestId('person-menu').click()
  await page.getByTestId('person-menu-delete').click()
  const dialog = page.getByTestId('person-delete-dialog')
  await expect(dialog).toBeVisible()
  const confirm = dialog.getByTestId('confirm-action')
  await expect(confirm).toBeDisabled()
  await dialog.getByTestId('confirm-text').fill('someone@example.com')
  await expect(confirm).toBeDisabled()
  await dialog.getByTestId('confirm-text').fill(people.mia)
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expectToast(page, `${names.mia} was deleted`)
  await expect(page).toHaveURL(/\/agency\/people\/?(?:\?.*)?$/)
  await searchPeople(page, people.mia)
  await expect(page.getByText('Nothing matches')).toBeVisible()
  await expect(page.getByTestId(`person-row-${people.mia}`)).toHaveCount(0)
})

test('bulk block and unblock two people; Escape clears the selection', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await login(page)
  await searchPeople(page, suffix)

  await selectBox(page, people.sam).click()
  await selectBox(page, people.jane).click()
  await expect(page.getByTestId('people-bulk-bar')).toBeVisible()
  await expect(page.getByTestId('people-bulk-count')).toHaveText('2 selected')
  await page.getByTestId('bulk-block').click()
  await page
    .getByTestId('people-bulk-confirm')
    .getByTestId('confirm-action')
    .click()
  await expectToast(page, 'Blocked 2 people')
  await expect(page.getByTestId(`person-row-${people.sam}`)).toContainText(
    'Blocked',
  )
  await expect(page.getByTestId(`person-row-${people.jane}`)).toContainText(
    'Blocked',
  )

  // A finished bulk action clears the selection, so pick them again.
  await selectBox(page, people.sam).click()
  await selectBox(page, people.jane).click()
  await page.getByTestId('bulk-unblock').click()
  await page
    .getByTestId('people-bulk-confirm')
    .getByTestId('confirm-action')
    .click()
  await expectToast(page, 'Unblocked 2 people')
  await expect(page.getByTestId(`person-row-${people.sam}`)).not.toContainText(
    'Blocked',
  )

  await selectBox(page, people.john).click()
  await expect(page.getByTestId('people-bulk-bar')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('people-bulk-bar')).toHaveCount(0)
})

test('invites a person to two clients, and adds an existing person directly', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await login(page)
  const invitee = `invitee+${suffix}@example.com`
  await inviteToClients(page, invitee, [
    { slug: slugs.b, name: clients.b, role: 'editor' },
    { slug: slugs.c, name: clients.c, role: 'owner' },
  ])
  await expectToast(page, '2 invitations sent')
  await searchPeople(page, suffix)
  await expect(page.getByTestId(`invitation-row-${invitee}`)).toHaveCount(2)

  // An email that already has an account is offered a direct add instead.
  await page.getByTestId('invite-person').click()
  await page.getByTestId('invite-person-email').fill(people.jane)
  await expect(page.getByTestId('invite-person-existing')).toContainText(
    `${names.jane} already has an account`,
  )
  await page.getByTestId('invite-person-clients-add').click()
  await page.getByTestId('client-picker-search').fill(clients.c)
  await page.getByTestId(`client-picker-option-${slugs.c}`).click()
  await page.getByTestId('client-picker-add').click()
  await page.getByTestId('invite-person-add-direct').click()
  await expectToast(page, `Added ${names.jane} to the clients`)
})

test('Cmd+K finds a person and opens their page', async ({ page }) => {
  test.setTimeout(240_000)
  await login(page)
  await openAgencyPeople(page)
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByTestId('command-input')).toBeVisible({
      timeout: 2_000,
    })
  }).toPass({ timeout: 20_000 })
  await page.getByTestId('command-input').fill(people.sam)
  const result = page.getByTestId(`palette-person-${people.sam}`)
  await expect(result).toBeVisible()
  await expect(result).toContainText(names.sam)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/agency\/people\/[^/?#]+$/)
  await expect(page.getByTestId('person-page')).toBeVisible()
})

test('on a phone, a client row opens a sheet to change its role', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  await openPersonPage(page, people.jane)

  await page.getByTestId(`access-open-${slugs.a}`).click()
  const sheet = page.getByTestId('person-client-sheet')
  await expect(sheet).toBeVisible()
  await sheet
    .getByTestId('person-client-sheet-role')
    .getByRole('radio', { name: 'Editor' })
    .click()
  await page.getByTestId('slide-over-close').click()
  await expect(page.getByTestId('person-save-bar')).toBeVisible()
  await expect(page.getByTestId('person-save-summary')).toHaveText(
    '1 role change',
  )
  await page.getByTestId('person-discard').click()
  await expect(page.getByTestId('person-save-bar')).toHaveCount(0)
})
