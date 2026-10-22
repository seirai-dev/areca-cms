import { expect, test } from '@playwright/test'

import {
  ACME_SITE,
  OWNER,
  expectDisabledWithReason,
  login,
  openCollection,
  openSite,
  startNewEntry,
  uniqueSuffix,
  waitForSaved,
  writeArticle,
} from './helpers'

test('preview needs a saved entry; its signed URL serves the draft and rejects tampering', async ({
  page,
  request,
}) => {
  const title = `E2E Preview ${uniqueSuffix()}`

  await login(page, OWNER)
  await openSite(page, ACME_SITE)
  await openCollection(page, 'articles')
  await startNewEntry(page)

  // Nothing to preview until the entry exists.
  await expectDisabledWithReason(
    page,
    page.getByTestId('preview-entry'),
    'Preview works once the entry is saved.',
  )

  await writeArticle(page, title)
  await waitForSaved(page)

  const preview = page.getByTestId('preview-entry')
  await expect(preview).toHaveAttribute('href', /[?&]token=/)
  await expect(preview).toHaveAttribute('target', '_blank')
  const href = (await preview.getAttribute('href')) ?? ''
  const token = new URL(href).searchParams.get('token')
  expect(token).toBeTruthy()

  const ok = await request.get(
    `/api/sites/preview?token=${encodeURIComponent(token!)}`,
  )
  expect(ok.status()).toBe(200)
  const body = (await ok.json()) as { entry: { data: { title?: string } } }
  expect(body.entry.data.title).toBe(title)

  const tampered = token!.endsWith('a')
    ? `${token!.slice(0, -1)}b`
    : `${token}a`
  const denied = await request.get(
    `/api/sites/preview?token=${encodeURIComponent(tampered)}`,
  )
  expect(denied.status()).toBe(401)
})
