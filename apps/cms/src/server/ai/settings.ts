import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { aiSettings } from '#/db/schema'
import { env } from '#/env'
import { DEFAULT_SEO_SYSTEM_PROMPT } from '#/lib/ai-seo'
import { audit } from '#/server/audit'
import { ValidationError } from '#/server/content/errors'
import {
  decryptSecret,
  encryptSecret,
} from '#/server/security/secret-encryption'

import { verifyOpenRouterKey } from './openrouter.ts'

const ROW_ID = 'default'
const ENCRYPTION_CONTEXT = 'ai-settings:openrouter-api-key'
export const AI_PROMPT_MAX_LENGTH = 20_000
export const AI_MODEL_MAX_LENGTH = 200

type FetchFn = typeof fetch

async function getRow() {
  const rows = await db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.id, ROW_ID))
    .limit(1)
  return rows.at(0) ?? null
}

function encryptionKey() {
  return env.AI_SETTINGS_ENCRYPTION_KEY ?? null
}

/** Admin DTO. Never contains the API key. */
export async function getAiSettingsStatus() {
  const row = await getRow()
  return {
    encryptionReady: Boolean(encryptionKey()),
    // Sent from the server so the client bundle never names a server secret
    // (see scripts/scan-client-bundle.mjs).
    encryptionKeyEnv: 'AI_SETTINGS_ENCRYPTION_KEY',
    keyConfigured: Boolean(row?.encryptedApiKey),
    model: row?.model ?? null,
    systemPrompt: row?.systemPrompt ?? null,
    defaultSystemPrompt: DEFAULT_SEO_SYSTEM_PROMPT,
    updatedAt: row?.updatedAt ?? null,
  }
}

export async function saveAiSettings(input: {
  /** New key; omitted keeps the stored one. */
  apiKey?: string
  /** True removes the stored key. */
  clearApiKey?: boolean
  model?: string | null
  /** Null resets to the built-in default prompt. */
  systemPrompt?: string | null
  actorId: string
  fetch?: FetchFn
}) {
  const key = encryptionKey()
  const existing = await getRow()
  const enteredKey = input.apiKey?.trim()

  let encryptedApiKey = existing?.encryptedApiKey ?? null
  if (input.clearApiKey) encryptedApiKey = null
  if (enteredKey) {
    if (!key) {
      throw new ValidationError([
        {
          path: 'apiKey',
          message:
            'Set AI_SETTINGS_ENCRYPTION_KEY on the server before saving an API key',
        },
      ])
    }
    const valid = await verifyOpenRouterKey(enteredKey, input.fetch)
    if (!valid) {
      throw new ValidationError([
        { path: 'apiKey', message: 'OpenRouter rejected this API key' },
      ])
    }
    encryptedApiKey = encryptSecret(enteredKey, key, ENCRYPTION_CONTEXT)
  }

  const model =
    input.model === undefined
      ? (existing?.model ?? null)
      : input.model?.trim() || null
  // A key without a model cannot generate anything. Only checked for a new
  // key, so existing setups can still be edited or have their key removed.
  if (enteredKey && !model) {
    throw new ValidationError([{ path: 'model', message: 'Choose a model' }])
  }
  const prompt =
    input.systemPrompt === undefined
      ? (existing?.systemPrompt ?? null)
      : input.systemPrompt?.trim() &&
          input.systemPrompt.trim() !== DEFAULT_SEO_SYSTEM_PROMPT.trim()
        ? input.systemPrompt
        : null

  const values = {
    encryptedApiKey,
    model,
    systemPrompt: prompt,
    updatedBy: input.actorId,
    updatedAt: new Date(),
  }
  await db.transaction(async (tx) => {
    await tx
      .insert(aiSettings)
      .values({ id: ROW_ID, ...values })
      .onConflictDoUpdate({ target: aiSettings.id, set: values })
    const changed = [
      ...(enteredKey ? ['apiKey'] : []),
      ...(input.clearApiKey ? ['apiKeyRemoved'] : []),
      ...(model !== (existing?.model ?? null) ? ['model'] : []),
      ...(prompt !== (existing?.systemPrompt ?? null) ? ['systemPrompt'] : []),
    ]
    await audit(
      {
        organizationId: null,
        actorId: input.actorId,
        action: 'ai.settings_update',
        targetType: 'ai_settings',
        targetId: ROW_ID,
        meta: { fields: changed, model },
      },
      tx,
    )
  })
  return getAiSettingsStatus()
}

export type AiRuntimeConfig = {
  apiKey: string
  model: string
  systemPrompt: string
}

/** Decrypted config for server-side calls, or null when AI is not set up. */
export async function loadAiRuntimeConfig(): Promise<AiRuntimeConfig | null> {
  const key = encryptionKey()
  const row = await getRow()
  if (!key || !row?.encryptedApiKey || !row.model) return null
  try {
    return {
      apiKey: decryptSecret(row.encryptedApiKey, key, ENCRYPTION_CONTEXT),
      model: row.model,
      systemPrompt: row.systemPrompt?.trim() || DEFAULT_SEO_SYSTEM_PROMPT,
    }
  } catch {
    // Rotated or wrong encryption key: treat as not configured.
    return null
  }
}

/** Whether editors should see AI actions. Cheap, no decryption. */
export async function isAiEnabled() {
  if (!encryptionKey()) return false
  const row = await getRow()
  return Boolean(row?.encryptedApiKey && row.model)
}
