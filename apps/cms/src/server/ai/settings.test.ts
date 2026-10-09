import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import { aiSettings, auditLog, user } from '#/db/schema'
import { DEFAULT_SEO_SYSTEM_PROMPT } from '#/lib/ai-seo'
import { ValidationError } from '#/server/content/errors'

import {
  getAiSettingsStatus,
  isAiEnabled,
  loadAiRuntimeConfig,
  saveAiSettings,
} from './settings.ts'

/*
 * This suite writes the singleton `ai_settings` row ('default') in the dev
 * database. The row is backed up before the first test and restored exactly
 * afterwards (including updated_at and the encrypted key bytes). Every test
 * starts from an empty row, so nothing here depends on the configured model.
 */

const hasDb = Boolean(process.env.DATABASE_URL)
const ROW_ID = 'default'
const RAW_KEY = 'sk-or-test-settings-secret-0001'
const CUSTOM_PROMPT = '  Write in a warm, plain tone.  '

const okFetch: typeof fetch = async () =>
  new Response('{"data":{}}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const rejectingFetch: typeof fetch = async () =>
  new Response('{}', { status: 401 })

describe.skipIf(!hasDb)('AI settings (ai_settings row)', () => {
  let original: typeof aiSettings.$inferSelect | undefined
  let actorId = ''

  beforeAll(async () => {
    original = (
      await db
        .select()
        .from(aiSettings)
        .where(eq(aiSettings.id, ROW_ID))
        .limit(1)
    ).at(0)
    const suffix = crypto.randomUUID()
    const [actor] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: 'AI Settings Test',
        email: `ai-settings-${suffix}@test.local`,
        emailVerified: true,
      })
      .returning()
    actorId = actor.id
  })

  beforeEach(async () => {
    await db.delete(aiSettings).where(eq(aiSettings.id, ROW_ID))
  })

  afterAll(async () => {
    // Restore the exact original row, or leave no row if there was none.
    await db.delete(aiSettings).where(eq(aiSettings.id, ROW_ID))
    if (original) await db.insert(aiSettings).values(original)
    if (actorId) {
      // Drop the audit rows these tests wrote, then the throwaway user.
      await db.delete(auditLog).where(eq(auditLog.actorId, actorId))
      await db.delete(user).where(eq(user.id, actorId))
    }
  })

  it('rejects a key that OpenRouter refuses, and stores nothing', async () => {
    const error = await saveAiSettings({
      apiKey: RAW_KEY,
      model: 'vendor/model',
      actorId,
      fetch: rejectingFetch,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).errors).toEqual([
      { path: 'apiKey', message: 'OpenRouter rejected this API key' },
    ])
    expect((await getAiSettingsStatus()).keyConfigured).toBe(false)
  })

  it('requires a model when a new key is entered', async () => {
    const error = await saveAiSettings({
      apiKey: RAW_KEY,
      model: '   ',
      actorId,
      fetch: okFetch,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).errors).toEqual([
      { path: 'model', message: 'Choose a model' },
    ])
    expect((await getAiSettingsStatus()).keyConfigured).toBe(false)
  })

  it('stores an encrypted key; status reports it without the secret', async () => {
    const status = await saveAiSettings({
      apiKey: RAW_KEY,
      model: 'vendor/model',
      actorId,
      fetch: okFetch,
    })

    expect(status).toMatchObject({
      keyConfigured: true,
      model: 'vendor/model',
      systemPrompt: null,
      defaultSystemPrompt: DEFAULT_SEO_SYSTEM_PROMPT,
    })
    expect(JSON.stringify(status)).not.toContain(RAW_KEY)
    expect(await getAiSettingsStatus()).toMatchObject({ keyConfigured: true })

    const row = (
      await db.select().from(aiSettings).where(eq(aiSettings.id, ROW_ID))
    ).at(0)
    expect(row?.encryptedApiKey).toBeTruthy()
    expect(row?.encryptedApiKey).not.toContain(RAW_KEY)
  })

  it('decrypts the stored key back for server-side calls', async () => {
    await saveAiSettings({
      apiKey: RAW_KEY,
      model: 'vendor/model',
      actorId,
      fetch: okFetch,
    })
    await expect(loadAiRuntimeConfig()).resolves.toEqual({
      apiKey: RAW_KEY,
      model: 'vendor/model',
      systemPrompt: DEFAULT_SEO_SYSTEM_PROMPT,
    })
  })

  it('stores a prompt equal to the default as null, and a custom one trimmed on use', async () => {
    await saveAiSettings({
      apiKey: RAW_KEY,
      model: 'vendor/model',
      systemPrompt: DEFAULT_SEO_SYSTEM_PROMPT,
      actorId,
      fetch: okFetch,
    })
    const defaultRow = (
      await db.select().from(aiSettings).where(eq(aiSettings.id, ROW_ID))
    ).at(0)
    expect(defaultRow?.systemPrompt).toBeNull()

    const status = await saveAiSettings({
      systemPrompt: CUSTOM_PROMPT,
      actorId,
    })
    expect(status.systemPrompt).toBe(CUSTOM_PROMPT)
    await expect(loadAiRuntimeConfig()).resolves.toMatchObject({
      systemPrompt: CUSTOM_PROMPT.trim(),
    })

    // Resetting to the default clears the override again.
    await saveAiSettings({ systemPrompt: null, actorId })
    expect((await getAiSettingsStatus()).systemPrompt).toBeNull()
  })

  it('keeps the stored key when only the model changes', async () => {
    await saveAiSettings({
      apiKey: RAW_KEY,
      model: 'vendor/model',
      actorId,
      fetch: okFetch,
    })
    await saveAiSettings({ model: 'vendor/other', actorId })
    await expect(loadAiRuntimeConfig()).resolves.toMatchObject({
      apiKey: RAW_KEY,
      model: 'vendor/other',
    })
  })

  it('clearApiKey removes the key and disables AI', async () => {
    await saveAiSettings({
      apiKey: RAW_KEY,
      model: 'vendor/model',
      actorId,
      fetch: okFetch,
    })
    expect(await isAiEnabled()).toBe(true)

    const status = await saveAiSettings({ clearApiKey: true, actorId })
    expect(status.keyConfigured).toBe(false)
    expect(await isAiEnabled()).toBe(false)
    expect(await loadAiRuntimeConfig()).toBeNull()
  })

  it('AI is enabled only with both a key and a model', async () => {
    expect(await isAiEnabled()).toBe(false)

    await saveAiSettings({
      apiKey: RAW_KEY,
      model: 'vendor/model',
      actorId,
      fetch: okFetch,
    })
    expect(await isAiEnabled()).toBe(true)

    await saveAiSettings({ model: '', actorId })
    expect(await isAiEnabled()).toBe(false)
    expect(await loadAiRuntimeConfig()).toBeNull()
  })
})
