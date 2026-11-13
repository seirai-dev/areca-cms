import { z } from '#/lib/zod'

import {
  ALT_TEXT_MAX_LENGTH,
  SEARCH_MAX_LENGTH,
  URL_MAX_LENGTH,
} from '#/lib/content-limits'
import type { Asset } from '#/server/assets'
import { assetUrl, assetUsage, deleteAsset, updateAsset } from '#/server/assets'
import { siteAssets, siteAssetsAmong } from '#/server/assets/site-scope'
import { uploadAssetFromUrl } from '#/server/assets/remote'
import { assetPreview } from '#/server/assets/preview'
import {
  createUploadSession,
  finishSession,
  findSessionForActor,
  sessionAssets,
  sessionState,
  UPLOAD_PURPOSE_MAX_LENGTH,
  UPLOAD_SESSION_MAX_FILES,
  uploadSessionUrls,
} from '#/server/assets/upload-sessions'
import type { UploadSession } from '#/server/assets/upload-sessions'
import { audit } from '#/server/audit'
import { loadSiteLanguages } from '#/server/content/locale-validation'
import { McpNotFoundError } from '../errors'
import { resolveLocale } from '../locales'
import { localeInput } from './entries'

import { idSchema } from '../schemas'
import { ResultWithImages } from '../tool-kit'
import type { ToolCollector, ToolImage } from '../tool-kit'
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
  const row = (
    await siteAssetsAmong(actor.organizationId, actor.siteId, {
      ids: [id],
      storageKeys: [],
    })
  ).at(0)
  if (!row) {
    throw new McpNotFoundError(
      `No asset with id "${id}" available to this site. Call list_assets to find valid ids.`,
    )
  }
  return row
}

/** Previews for the images among these assets, in order; PDFs have none. */
async function previewsOf(rows: Asset[]): Promise<{
  images: ToolImage[]
  hasPreview: Set<string>
}> {
  const previews = await Promise.all(rows.map((row) => assetPreview(row)))
  const images: ToolImage[] = []
  const hasPreview = new Set<string>()
  previews.forEach((preview, index) => {
    const row = rows.at(index)
    if (!preview || !row) return
    images.push(preview)
    hasPreview.add(row.id)
  })
  return { images, hasPreview }
}

const ACCEPTED_TYPES = 'JPEG, PNG, WebP, GIF or PDF, up to 20 MB each'

function nextStep(session: UploadSession, uploaded: number): string {
  const state = sessionState(session)
  if (state === 'finished') {
    return uploaded
      ? 'The link is closed. Look at the previews, decide where each image goes, set alt text with update_asset_alt, and use the assetIds in your entry.'
      : 'The link was closed without any files. Ask the user whether they still want to add images; create a new upload link if so.'
  }
  if (state === 'expired') {
    return uploaded
      ? 'The link expired; the files below were saved. Use them, or create a new upload link for more.'
      : 'The link expired without any files. Create a new upload link if the user still wants to add images.'
  }
  return 'The link is still open. If you sent the files with curl, call get_asset_upload again with finish: true (required to close the link). If the user is using the page, wait until they say they are done, then call get_asset_upload again.'
}

export function registerAssetTools(registry: ToolCollector): void {
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
      'Returns one asset with its url, alt text, size, and usageCount (how many entries, revisions or published snapshots use it), plus a preview of the image (up to 1024 px) so you can see what it shows. PDFs have no preview. Read-only.',
    inputSchema: z.object({ id: idSchema('asset') }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (input, actor) => {
      const row = await requireAsset(actor, input.id)
      const [usageCount, preview] = await Promise.all([
        assetUsage(row.id, actor.organizationId),
        assetPreview(row),
      ])
      return new ResultWithImages(
        { ...describeAsset(row), usageCount, preview: Boolean(preview) },
        preview ? [preview] : [],
      )
    },
  })

  registry.add({
    name: 'upload_asset_from_url',
    title: 'Upload asset from URL',
    description:
      'Downloads a public image (JPEG, PNG, WebP, GIF) or PDF from an http(s) URL into the library and returns its assetId. Use a direct link to the image file, not a web page that contains it. Private or local addresses are refused, and the bytes must really be an image or PDF. Always pass altText describing the image for accessibility and SEO. Max 20 MB. If an upload fails, do not guess other URLs: ask the user for a working link, offer an upload link (create_asset_upload), or continue without the image. For local files or images attached to the chat, use create_asset_upload instead.',
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
    name: 'create_asset_upload',
    title: 'Create upload link',
    description:
      `Opens a one-time upload link for images and PDFs that are not at a public URL: local files, or images the user attached to the chat. Returns uploadId, pageUrl and uploadUrl. The link takes up to ${UPLOAD_SESSION_MAX_FILES} files (${ACCEPTED_TYPES}) and works for 20 minutes. ` +
      'If you can run a shell, send each file with curl -sS -T <file> "<uploadUrl>/" (each response has the assetId), then call get_asset_upload with finish: true; that call is required, it closes the link. ' +
      'Otherwise give the user the pageUrl: they open it, add the images and press Upload, which closes the link. Then call get_asset_upload to get the files with previews. ' +
      'Never ask the user to host the image or to share storage credentials.',
    inputSchema: z.object({
      purpose: z
        .string()
        .max(UPLOAD_PURPOSE_MAX_LENGTH)
        .optional()
        .describe(
          'Shown to the user on the upload page, e.g. "Photos for the Lisbon trip post".',
        ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    run: async (input, actor) => {
      const { session, token } = await createUploadSession({
        organizationId: actor.organizationId,
        siteId: actor.siteId,
        userId: actor.userId,
        credential: { kind: actor.credential, id: actor.keyId },
        purpose: input.purpose,
      })
      const { pageUrl, uploadUrl } = uploadSessionUrls(token)
      return {
        uploadId: session.id,
        pageUrl,
        uploadUrl,
        expiresAt: session.expiresAt.toISOString(),
        maxFiles: session.maxFiles,
        accepts: ACCEPTED_TYPES,
        withShell: `curl -sS -T photo.jpg "${uploadUrl}/" for each file (or curl -sS -T "{a.jpg,b.png}" "${uploadUrl}/"), then get_asset_upload({ uploadId: "${session.id}", finish: true }). finish: true is required to close the link.`,
        withoutShell: `Ask the user to open ${pageUrl}, add the images and press Upload. When they say they are done, call get_asset_upload({ uploadId: "${session.id}" }).`,
      }
    },
  })

  registry.add({
    name: 'get_asset_upload',
    title: 'Get upload link files',
    description:
      'Returns the state of an upload link from create_asset_upload (open, finished or expired) and every file saved through it, each with its assetId and a preview image (up to 1024 px) so you can see what was uploaded. ' +
      'Pass finish: true after your last curl upload: it is required to close the link, and it returns every file at once. The upload page closes the link itself. ' +
      'Then look at the previews, decide where each image goes, set alt text with update_asset_alt, and use the assetIds in image fields, seo.ogImage or ![alt](asset:<assetId>).',
    inputSchema: z.object({
      uploadId: idSchema('upload'),
      finish: z
        .boolean()
        .optional()
        .describe(
          'true closes the link now. Required after uploading with curl; no more files can be sent afterwards.',
        ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      let session = await findSessionForActor(input.uploadId, actor)
      if (!session) {
        throw new McpNotFoundError(
          `No upload link with id "${input.uploadId}" for you on this site. Create one with create_asset_upload.`,
        )
      }
      if (input.finish && sessionState(session) === 'open') {
        session = await finishSession(session.id)
      }
      const rows = await sessionAssets(session.id)
      const { images, hasPreview } = await previewsOf(rows)
      return new ResultWithImages(
        {
          uploadId: session.id,
          state: sessionState(session),
          purpose: session.purpose,
          expiresAt: session.expiresAt.toISOString(),
          uploaded: rows.length,
          maxFiles: session.maxFiles,
          files: rows.map((row) => ({
            ...describeAsset(row),
            preview: hasPreview.has(row.id),
          })),
          previews:
            'Preview images follow in the same order as files (PDFs have none).',
          next: nextStep(session, rows.length),
        },
        images,
      )
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
        { actorId: actor.userId, siteId: actor.siteId },
      )
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
      await requireAsset(actor, input.id)
      await deleteAsset(input.id, actor.organizationId, {
        actorId: actor.userId,
        siteId: actor.siteId,
      })
      return { deleted: true, assetId: input.id }
    },
  })
}
