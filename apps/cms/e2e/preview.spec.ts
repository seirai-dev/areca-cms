import { expect, test } from '@playwright/test'

import {
  createAndSaveArticle,
  login,
  openSite,
  uniqueSuffix,
} from './helpers'

test('preview token returns draft data; tampered token is 401', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)
  const title = `E2E Preview ${uniqueSuffix()}`

  await login(page, 'owner@acme.local')
  await openSite(page, /acme-site/i)
  await createAndSaveArticle(page, title)

  const preview = page.getByTestId('preview-entry')
  await expect(preview).toHaveAttribute('href', /[?&]token=/, { timeout: 15_000 })
  const href = (await preview.getAttribute('href')) ?? ''
  const token = new URL(href).searchParams.get('token')
  expect(token).toBeTruthy()

  const ok = await request.get(
    `/api/sites/preview?token=${encodeURIComponent(token!)}`,
  )
  expect(ok.status()).toBe(200)
  const body = (await ok.json()) as { entry: { data: { title?: string } } }
  expect(body.entry.data.title).toBe(title)

  const tampered = token!.endsWith('a') ? `${token!.slice(0, -1)}b` : `${token}a`
  const denied = await request.get(
    `/api/sites/preview?token=${encodeURIComponent(tampered)}`,
  )
  expect(denied.status()).toBe(401)
})
