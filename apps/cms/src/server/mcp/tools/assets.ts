import { z } from 'zod'

import {
  ALT_TEXT_MAX_LENGTH,
  SEARCH_MAX_LENGTH,
  URL_MAX_LENGTH,
} from '#/lib/content-limits'
import type { Asset } from '#/server/assets'
import { assetUrl, assetUsage, deleteAsset, updateAsset } from '#/server/assets'
import { siteAssets } from '#/server/assets/site-scope'
import { uploadAssetFromUrl } from '#/server/assets/remote'
import { audit } from '#/server/audit'
import { loadSiteLanguages } from '#/server/content/locale-validation'
import { McpNotFoundError } from '../errors'
import { resolveLocale } from '../locales'
import { localeInput } from './entries'

import { idSchema } from '../schemas'
import type { ToolRegistry } from '../tool-kit'
import type { McpActor } from '../keys'

function describeAsset(row: Asset) {
  return {
    assetId: row.id,
    filename: row.originalFilename,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    alt: row.altText ?? '',
    url: assetUrl(row),
    createdAt: row.createdAt.toISOString(),
  }
}

async function requireAsset(actor: McpActor, id: string): Promise<Asset> {
  const row = (await siteAssets(actor.organizationId, actor.siteId)).find(
    (item) => item.id === id,
  )
  if (!row) {
    throw new McpNotFoundError(
      `No asset with id "${id}" available to this site. Call list_assets to find valid ids.`,
    )
  }
  return row
}

export function registerAssetTools(registry: ToolRegistry): void {
  registry.add({
    name: 'list_assets',
    title: 'List assets',
    description:
      'Lists images and PDFs referenced by this site or uploaded through its AI connection, newest first, with assetId, filename, alt text and url. Search matches filename or alt text. Use an assetId in image fields, seo.ogImage, or ![alt](asset:<assetId>) in Markdown.',
    inputSchema: z.object({
      search: z
        .string()
        .max(SEARCH_MAX_LENGTH)
        .optional()
        .describe('Text to match in filename or alt text.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Page size, 1-100. Default 20.'),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Number of assets to skip. Default 0.'),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (input, actor) => {
      const search = input.search?.trim().toLowerCase()
      const allowed = await siteAssets(actor.organizationId, actor.siteId)
      const matches = search
        ? allowed.filter(
            (row) =>
              row.originalFilename.toLowerCase().includes(search) ||
              row.altText?.toLowerCase().includes(search),
          )
        : allowed
      const offset = input.offset ?? 0
      const rows = matches.slice(offset, offset + (input.limit ?? 20))
      return rows.map(describeAsset)
    },
  })

  registry.add({
    name: 'get_asset',
    title: 'Get asset',
    description:
      'Returns one asset with its url, alt text, size, and usageCount (how many entries, revisions or published snapshots use it). Read-only.',
    inputSchema: z.object({ id: idSchema('asset') }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (input, actor) => {
      const row = await requireAsset(actor, input.id)
      return {
        ...describeAsset(row),
        usageCount: await assetUsage(row.id, actor.organizationId),
      }
    },
  })

  registry.add({
    name: 'upload_asset_from_url',
    title: 'Upload asset from URL',
    description:
      'Downloads a public image (JPEG, PNG, WebP, GIF) or PDF from an http(s) URL into the library and returns its assetId. Use a direct link to the image file, not a web page that contains it. Private or local addresses are refused, and the bytes must really be an image or PDF. Always pass altText describing the image for accessibility and SEO. Max 20 MB. If an upload fails, do not guess other URLs: ask the user for a working link, or continue without the image.',
    inputSchema: z.object({
      url: z
        .string()
        .min(1)
        .max(URL_MAX_LENGTH)
        .url()
        .describe(
          'Public https URL of the file, e.g. https://example.com/photo.jpg.',
        ),
      altText: z
        .string()
        .max(ALT_TEXT_MAX_LENGTH)
        .optional()
        .describe(
          'What the image shows, in one sentence. Recommended for every image.',
        ),
      filename: z
        .string()
        .max(200)
        .optional()
        .describe(
          'Optional file name to store, e.g. "sourdough-loaf.jpg". Derived from the URL if omitted.',
        ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    run: async (input, actor) => {
      const row = await uploadAssetFromUrl({
        organizationId: actor.organizationId,
        originSiteId: actor.siteId,
        url: input.url,
        altText: input.altText,
        filename: input.filename,
        actorId: actor.userId,
      })
      await audit({
        organizationId: actor.organizationId,
        siteId: actor.siteId,
        actorId: actor.userId,
        action: 'asset.upload',
        targetType: 'asset',
        targetId: row.id,
        meta: { filename: row.originalFilename },
      })
      return {
        ...describeAsset(row),
        howToUse:
          'Use this assetId in an image field, in seo.ogImage, or as ![alt](asset:<assetId>) inside Markdown rich text.',
      }
    },
  })

  registry.add({
    name: 'update_asset_alt',
    title: 'Update alt text',
    description:
      'Sets the alt text of an asset: one sentence describing what the image shows, for screen readers and search. Pass an empty string to clear it. On a site with languages, locale sets the alt text for that language (the main alt is used where a language has none).',
    inputSchema: z.object({
      id: idSchema('asset'),
      altText: z
        .string()
        .max(ALT_TEXT_MAX_LENGTH)
        .describe('The new alt text. Empty string clears it.'),
      locale: localeInput,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      await requireAsset(actor, input.id)
      const languages = await loadSiteLanguages(actor.siteId)
      const target = resolveLocale(languages, input.locale)
      const row = await updateAsset(
        input.id,
        {
          altText: input.altText,
          locale: target?.locale ?? null,
          mainLocale: languages?.main ?? null,
        },
        actor.organizationId,
      )
      await audit({
        organizationId: actor.organizationId,
        siteId: actor.siteId,
        actorId: actor.userId,
        action: 'asset.update',
        targetType: 'asset',
        targetId: row.id,
        meta: { filename: row.originalFilename },
      })
      return {
        ...describeAsset(row),
        ...(target && !target.isMain
          ? {
              locale: target.locale,
              localeAlt: row.altI18n[target.locale] || '',
            }
          : {}),
      }
    },
  })

  registry.add({
    name: 'delete_asset',
    title: 'Delete asset',
    description:
      'Owner action, destructive. Deletes an asset from the library. Refused while any entry, revision or published snapshot still uses it; the error says how many. Only delete when the user asked.',
    inputSchema: z.object({ id: idSchema('asset') }),
    access: 'owner',
    deniedMessage: 'Only site owners can delete files. Ask a site owner.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      const row = await requireAsset(actor, input.id)
      await deleteAsset(input.id, actor.organizationId)
      await audit({
        organizationId: actor.organizationId,
        siteId: actor.siteId,
        actorId: actor.userId,
        action: 'asset.delete',
        targetType: 'asset',
        targetId: row.id,
        meta: { filename: row.originalFilename },
      })
      return { deleted: true, assetId: input.id }
    },
  })
}
