import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import {
  createIsolatedAcmeSite,
  login,
  openClient,
  openSite,
  uniqueSuffix,
} from './helpers'

/** Use the same serializer as Start; mocked responses never reach a provider. */
const require = createRequire(
  realpathSync(
    new URL(
      '../node_modules/@tanstack/react-start/package.json',
      import.meta.url,
    ),
  ),
)
// eslint-disable-next-line import/no-commonjs -- Resolve Start's own transitive serializer without adding an application dependency.
const { toJSON } = require('seroval') as {
  toJSON: (value: unknown) => { t: unknown }
}

test('site and client settings retain drafts after switching tabs', async ({
  page,
}) => {
  const site = await createIsolatedAcmeSite(page, uniqueSuffix())
  await login(page)
  await openSite(page, site.siteSlug)
  await page.getByTestId('settings-nav').click()
  await page.getByTestId('settings-site-name').fill('Unsaved site draft')
  await page.getByRole('tab', { name: 'Developer', exact: true }).click()
  await expect(page.getByTestId('settings-site-name')).toBeHidden()
  await page.getByRole('tab', { name: 'General', exact: true }).click()
  await expect(page.getByTestId('settings-site-name')).toHaveValue(
    'Unsaved site draft',
  )
  await openClient(page, 'Acme', 'acme')
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await page.locator('#rename-org').fill('Unsaved client draft')
  await page.getByRole('tab', { name: 'Sites', exact: true }).click()
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await expect(page.locator('#rename-org')).toHaveValue('Unsaved client draft')
})

test('AI key removal retains unsaved settings without calling a provider', async ({
  page,
}) => {
  await login(page)
  const source = await (await page.request.get('/src/server/fn/ai.ts')).text()
  const ids = new Map<string, string>()
  for (const match of source.matchAll(/createClientRpc\("([^"]+)"\)/g)) {
    const id = match[1]
    const decoded = JSON.parse(Buffer.from(id, 'base64url').toString()) as {
      export: string
    }
    ids.set(decoded.export.split('_createServerFn')[0], id)
  }
  for (const name of ['getAiSettingsFn', 'saveAiSettingsFn', 'listAiModelsFn'])
    expect(ids.has(name)).toBe(true)
  const saved = {
    encryptionReady: true,
    encryptionKeyEnv: 'AI_SETTINGS_ENCRYPTION_KEY',
    keyConfigured: true,
    model: 'saved/model',
    systemPrompt: 'Saved instructions',
    defaultSystemPrompt: 'Default instructions',
    updatedAt: null,
  }
  let removed = false
  for (const name of [
    'getAiSettingsFn',
    'saveAiSettingsFn',
    'listAiModelsFn',
  ]) {
    await page.route(`**/_serverFn/${ids.get(name)}**`, async (route) => {
      if (name === 'saveAiSettingsFn') removed = true
      const result =
        name === 'listAiModelsFn' ? [] : { ...saved, keyConfigured: !removed }
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-tss-serialized': 'true',
        },
        body: JSON.stringify(
          toJSON({ result, error: undefined, context: {} }).t,
        ),
      })
    })
  }
  // Defensive provider block: a leaked model/key request fails locally.
  await page.route('https://openrouter.ai/**', (route) => route.abort())
  await page.goto('/agency/ai')
  await expect(page.getByTestId('ai-settings-page')).toBeVisible()
  await page.getByTestId('ai-model-trigger').click()
  await page.getByTestId('ai-model-search').fill('draft/model')
  await page.getByTestId('ai-model-custom').click()
  await page.getByTestId('ai-system-prompt').fill('Unsaved instructions')
  await page.getByTestId('ai-api-key').fill('Unsaved replacement key')
  await page.getByTestId('remove-ai-key').click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Remove key', exact: true })
    .click()
  await expect.poll(() => removed).toBe(true)
  await expect(page.getByTestId('remove-ai-key')).toHaveCount(0)
  await expect(page.getByTestId('ai-system-prompt')).toHaveValue(
    'Unsaved instructions',
  )
  await expect(page.getByTestId('ai-api-key')).toHaveValue(
    'Unsaved replacement key',
  )
  await expect(page.getByTestId('ai-model-trigger')).toContainText(
    'draft/model',
  )
  await expect(page.getByTestId('ai-save-bar')).toBeVisible()
})
