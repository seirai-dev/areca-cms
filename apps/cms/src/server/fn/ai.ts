import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from '#/lib/zod'

import { db } from '#/db'
import { site } from '#/db/schema'
import { canonicalLocale, localeTagSchema } from '#/lib/content-locale'
import { ID_MAX_LENGTH } from '#/lib/content-limits'
import {
  requireAgencyAdmin,
  requireFreshAgencyAdmin,
  requireOrgMemberOrNotFound,
  requireUser,
} from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { listOpenRouterModels } from '#/server/ai/openrouter'
import {
  AiGenerationError,
  generateSeoSuggestion,
} from '#/server/ai/seo-generate'
import {
  AI_MODEL_MAX_LENGTH,
  AI_PROMPT_MAX_LENGTH,
  getAiSettingsStatus,
  isAiEnabled,
  loadAiRuntimeConfig,
  saveAiSettings,
} from '#/server/ai/settings'
import { audit } from '#/server/audit'
import { getCollection } from '#/server/content/collections'
import { NotFoundError, ValidationError } from '#/server/content/errors'
import { resolveSlug, validateEntryData } from '#/server/content/validation'
import { allowUserAction } from '#/server/http/rate-limit.server'

const aiFn = { strict: { output: false } as const }

/** Paid calls: generous for real editing, tight enough to cap a runaway. */
const GENERATE_RULE = { limit: 30, windowSeconds: 60 * 60 }

export const getAiSettingsFn = createServerFn({
  method: 'GET',
  ...aiFn,
}).handler(async () => {
  await requireAgencyAdmin()
  return getAiSettingsStatus()
})

export const saveAiSettingsFn = createServerFn({ method: 'POST', ...aiFn })
  .validator(
    z.object({
      apiKey: z.string().max(500).optional(),
      clearApiKey: z.boolean().optional(),
      model: z.string().max(AI_MODEL_MAX_LENGTH).nullable().optional(),
      systemPrompt: z.string().max(AI_PROMPT_MAX_LENGTH).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    // Changing the stored secret needs a fresh second factor.
    const session =
      data.apiKey?.trim() || data.clearApiKey
        ? await requireFreshAgencyAdmin()
        : await requireAgencyAdmin()
    return saveAiSettings({ ...data, actorId: session.user.id })
  })

export const listAiModelsFn = createServerFn({
  method: 'GET',
  ...aiFn,
}).handler(async () => {
  await requireAgencyAdmin()
  return listOpenRouterModels()
})

/** Whether editors see "Generate with AI". Any signed-in user may ask. */
export const getAiAvailabilityFn = createServerFn({
  method: 'GET',
  ...aiFn,
}).handler(async () => {
  await requireUser()
  return { enabled: await isAiEnabled() }
})

export const generateEntrySeoFn = createServerFn({ method: 'POST', ...aiFn })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      collectionKey: z.string().min(1).max(200),
      entryId: z.string().max(ID_MAX_LENGTH).optional(),
      data: z.record(z.string(), z.unknown()),
      /** The language being edited. Alt text is suggested in it. */
      locale: localeTagSchema.optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser()
    const found = (
      await db.select().from(site).where(eq(site.id, data.siteId)).limit(1)
    ).at(0)
    if (!found) throw new NotFoundError(m.server_site_not_found())
    const locale = data.locale ? canonicalLocale(data.locale) : null
    if (locale && found.languages && !found.languages.all.includes(locale)) {
      throw new ValidationError([
        {
          path: 'locale',
          message: 'This language is not one of the site languages.',
        },
      ])
    }
    // The main language reads and writes the main alt, like no language at all.
    const altLocale =
      locale && found.languages && locale !== found.languages.main
        ? locale
        : null
    // Anyone who can edit the site's content (editor, owner, agency admin).
    const session = await requireOrgMemberOrNotFound(
      found.organizationId,
      undefined,
      () => new NotFoundError(m.server_site_not_found()),
    )
    const collection = await getCollection(found.id, data.collectionKey)
    if (!collection?.enabled)
      throw new NotFoundError(m.server_collection_not_found())

    // Unsaved editor state: validate the shape, keep incomplete values.
    const parsed = validateEntryData(collection.fields, data.data, {
      mode: 'partial',
      write: true,
    })
    if (!parsed.ok) throw new ValidationError(parsed.errors)

    const config = await loadAiRuntimeConfig()
    if (!config)
      throw new AiGenerationError(
        'AI is not set up yet. An agency admin can configure it under Agency → AI.',
        'not_configured',
      )
    if (!(await allowUserAction('ai-seo', session.user.id, GENERATE_RULE)))
      throw new AiGenerationError(
        'You have reached the hourly limit for AI suggestions. Try again later.',
        'rate_limited',
      )

    const result = await generateSeoSuggestion({
      config,
      sitePrompt: found.aiPrompt,
      site: found,
      collectionLabel: collection.label,
      routePattern: collection.routePattern,
      fields: collection.fields,
      data: parsed.data,
      slug: resolveSlug(parsed.data, collection.fields) ?? 'untitled',
      locale: altLocale,
    })

    await audit({
      organizationId: found.organizationId,
      siteId: found.id,
      actorId: session.user.id,
      action: 'entry.ai_seo_generate',
      targetType: 'entry',
      targetId: data.entryId ?? `new:${collection.key}`,
      meta: {
        collectionKey: collection.key,
        model: result.model,
        images: result.usedImages,
        ...result.usage,
      },
    })

    return result
  })
