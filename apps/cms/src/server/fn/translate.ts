import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from '#/lib/zod'

import { db } from '#/db'
import { site } from '#/db/schema'
import { ID_MAX_LENGTH } from '#/lib/content-limits'
import {
  canonicalLocale,
  localeTagSchema,
  readLocale,
} from '#/lib/content-locale'
import { requireOrgMemberOrNotFound, requireUser } from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { loadAssetLookup } from '#/server/assets'
import { richTextAssetRefs } from '#/server/assets/richtext-ownership'
import { AiGenerationError } from '#/server/ai/seo-generate'
import { loadAiRuntimeConfig } from '#/server/ai/settings'
import { translateContent } from '#/server/ai/translate'
import { audit } from '#/server/audit'
import { getCollection } from '#/server/content/collections'
import { getEntry } from '#/server/content/entries'
import { NotFoundError, ValidationError } from '#/server/content/errors'
import { languageName } from '#/server/content/locale-validation'
import { allowUserAction } from '#/server/http/rate-limit.server'

/**
 * Same paid-AI quota as generateEntrySeoFn (one bucket, so suggestions and
 * translations share the hourly cap). Keep these numbers in step with ai.ts.
 */
const AI_BUCKET = 'ai-seo'
const GENERATE_RULE = { limit: 30, windowSeconds: 60 * 60 }

/**
 * AI translation of one entry or site content section into another language.
 * Nothing is saved: the editor applies the returned values as a draft edit.
 * Access matches generateEntrySeoFn: anyone who can edit the site's content.
 */
export const translateContentFn = createServerFn({
  method: 'POST',
  strict: { output: false },
})
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      entryId: z.string().min(1).max(ID_MAX_LENGTH),
      /** Language to translate from. Defaults to the main language. */
      from: localeTagSchema.optional(),
      /** Language to translate into. Must differ from `from`. */
      to: localeTagSchema,
      /**
       * Field keys to translate even when the target already has them. `seo.<key>`
       * names an SEO value. Without it, only empty values are translated.
       */
      fields: z.array(z.string().min(1).max(200)).max(100).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser()
    const found = (
      await db.select().from(site).where(eq(site.id, data.siteId)).limit(1)
    ).at(0)
    if (!found) throw new NotFoundError(m.server_site_not_found())
    const session = await requireOrgMemberOrNotFound(
      found.organizationId,
      undefined,
      () => new NotFoundError(m.server_site_not_found()),
    )

    const languages = found.languages
    if (!languages) {
      throw new ValidationError([
        {
          path: 'to',
          message:
            'This site has one language, so there is nothing to translate.',
        },
      ])
    }
    const to = canonicalLocale(data.to)
    if (!to || !languages.all.includes(to)) {
      throw new ValidationError([
        {
          path: 'to',
          message: 'This language is not one of the site languages.',
        },
      ])
    }
    const from = data.from ? canonicalLocale(data.from) : languages.main
    if (!from || !languages.all.includes(from)) {
      throw new ValidationError([
        {
          path: 'from',
          message: 'This language is not one of the site languages.',
        },
      ])
    }
    if (from === to) {
      throw new ValidationError([
        {
          path: 'to',
          message: 'Choose a different language to translate into.',
        },
      ])
    }

    const row = await getEntry(data.entryId)
    if (!row || row.siteId !== found.id) {
      throw new NotFoundError(m.server_entry_not_found())
    }
    const collection = await getCollection(found.id, row.collectionKey)
    if (!collection?.enabled) {
      throw new NotFoundError(m.server_collection_not_found())
    }

    const config = await loadAiRuntimeConfig()
    if (!config) {
      throw new AiGenerationError(
        'AI is not set up yet. An agency admin can configure it under Agency → AI.',
        'not_configured',
      )
    }
    if (!(await allowUserAction(AI_BUCKET, session.user.id, GENERATE_RULE))) {
      throw new AiGenerationError(
        'You have reached the hourly limit for AI suggestions. Try again later.',
        'rate_limited',
      )
    }

    const ctx = {
      main: languages.main,
      all: languages.all,
      fields: collection.fields,
    }
    const storageKeys = collection.fields.flatMap((field) =>
      field.type === 'richtext'
        ? richTextAssetRefs(row.draftData[field.key]).storageKeys
        : [],
    )
    const assets = await loadAssetLookup(found.organizationId, {
      ids: [],
      storageKeys,
    })
    const result = await translateContent({
      config,
      sitePrompt: found.aiPrompt,
      siteName: found.name,
      fromName: languageName(from),
      toName: languageName(to),
      fields: collection.fields,
      source: readLocale(row.draftData, from, ctx),
      target: readLocale(row.draftData, to, ctx),
      // Collections always have an SEO panel; sections only when they opted in.
      seoEnabled: collection.kind === 'global' ? collection.seoEnabled : true,
      explicit: data.fields,
      assets,
    })

    await audit({
      organizationId: found.organizationId,
      siteId: found.id,
      actorId: session.user.id,
      action: 'entry.ai_translate',
      targetType: 'entry',
      targetId: row.id,
      meta: {
        collectionKey: collection.key,
        from,
        to,
        model: result.model,
        translated: [
          ...Object.keys(result.values),
          ...Object.keys(result.seo ?? {}).map((key) => `seo.${key}`),
        ],
        ...result.usage,
      },
    })

    return {
      values: result.values,
      ...(result.seo ? { seo: result.seo } : {}),
      skipped: result.skipped,
    }
  })
