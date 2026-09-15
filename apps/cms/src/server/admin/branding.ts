import { eq } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'

import { getStorage } from '#/adapters'
import { db } from '#/db'
import { branding } from '#/db/schema'
import {
  DEFAULT_APP_NAME,
  DEFAULT_FONT,
  isFontKey,
  normalizeHex,
} from '#/lib/branding'
import type { BrandingView, FontKey } from '#/lib/branding'
import { AssetValidationError } from '#/server/assets'

export type BrandingRow = InferSelectModel<typeof branding>

/** The table holds one row; this is its id. */
export const BRANDING_ID = 'default'

export type BrandingImageKind = 'logo' | 'favicon'

const IMAGE_MIMES: Record<BrandingImageKind, Record<string, string>> = {
  logo: {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
  },
  favicon: {
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
  },
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024

export function brandingImageUrl(key: string | null | undefined) {
  return key ? `/api/assets/file/${key}` : null
}

export async function getBrandingRow(): Promise<BrandingRow | null> {
  const rows = await db
    .select()
    .from(branding)
    .where(eq(branding.id, BRANDING_ID))
    .limit(1)
  return rows.at(0) ?? null
}

export function toBrandingView(row: BrandingRow | null): BrandingView {
  const font: FontKey = isFontKey(row?.font) ? row.font : DEFAULT_FONT
  const view: BrandingView = {
    appName: row?.appName?.trim() || DEFAULT_APP_NAME,
    logoUrl: brandingImageUrl(row?.logoKey),
    faviconUrl: brandingImageUrl(row?.faviconKey),
    faviconMime: row?.faviconMime ?? null,
    accentColor: row?.accentColor ?? null,
    font,
    emailFromName: row?.emailFromName?.trim() || null,
    customized: false,
  }
  view.customized =
    view.appName !== DEFAULT_APP_NAME ||
    view.logoUrl !== null ||
    view.faviconUrl !== null ||
    view.accentColor !== null ||
    view.font !== DEFAULT_FONT ||
    view.emailFromName !== null
  return view
}

export async function getBranding(): Promise<BrandingView> {
  return toBrandingView(await getBrandingRow())
}

type BrandingPatch = Partial<
  Pick<
    BrandingRow,
    | 'appName'
    | 'logoKey'
    | 'logoMime'
    | 'faviconKey'
    | 'faviconMime'
    | 'accentColor'
    | 'font'
    | 'emailFromName'
  >
>

async function upsertBranding(patch: BrandingPatch, actorId: string) {
  const values = { ...patch, updatedBy: actorId, updatedAt: new Date() }
  const rows = await db
    .insert(branding)
    .values({ id: BRANDING_ID, ...values })
    .onConflictDoUpdate({ target: branding.id, set: values })
    .returning()
  const row = rows.at(0)
  if (!row) {
    throw new Error('Failed to save branding')
  }
  return toBrandingView(row)
}

export async function updateBranding(
  input: {
    appName?: string | null
    accentColor?: string | null
    font?: string | null
    emailFromName?: string | null
  },
  actorId: string,
): Promise<BrandingView> {
  const patch: BrandingPatch = {}

  if (input.appName !== undefined) {
    const name = input.appName?.trim() ?? ''
    if (name.length > 60) {
      throw new AssetValidationError('Name must be 60 characters or fewer')
    }
    patch.appName = name && name !== DEFAULT_APP_NAME ? name : null
  }

  if (input.accentColor !== undefined) {
    if (!input.accentColor) {
      patch.accentColor = null
    } else {
      const hex = normalizeHex(input.accentColor)
      if (!hex) {
        throw new AssetValidationError(
          'Accent colour must be a hex value like #1e90ff',
        )
      }
      patch.accentColor = hex
    }
  }

  if (input.font !== undefined) {
    if (!input.font || input.font === DEFAULT_FONT) {
      patch.font = null
    } else if (isFontKey(input.font)) {
      patch.font = input.font
    } else {
      throw new AssetValidationError('Unknown font')
    }
  }

  if (input.emailFromName !== undefined) {
    const name = input.emailFromName?.trim() ?? ''
    if (name.length > 80) {
      throw new AssetValidationError(
        'Email sender name must be 80 characters or fewer',
      )
    }
    patch.emailFromName = name || null
  }

  return upsertBranding(patch, actorId)
}

export async function setBrandingImage(
  kind: BrandingImageKind,
  file: { buffer: Buffer; mimeType: string },
  actorId: string,
): Promise<BrandingView> {
  const mimeType = file.mimeType.toLowerCase()
  const ext = IMAGE_MIMES[kind][mimeType]
  if (!ext) {
    throw new AssetValidationError(
      kind === 'logo'
        ? 'Logo must be a PNG, JPEG, WebP, GIF, or SVG'
        : 'Favicon must be a PNG, SVG, or ICO',
    )
  }
  if (file.buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new AssetValidationError('Image exceeds the 2 MB size limit')
  }

  const previous = await getBrandingRow()
  const storageKey = `branding/${kind}-${crypto.randomUUID()}.${ext}`
  await getStorage().put(storageKey, file.buffer, mimeType)

  const view = await upsertBranding(
    kind === 'logo'
      ? { logoKey: storageKey, logoMime: mimeType }
      : { faviconKey: storageKey, faviconMime: mimeType },
    actorId,
  )

  await deleteImageQuietly(
    kind === 'logo' ? previous?.logoKey : previous?.faviconKey,
  )
  return view
}

export async function clearBrandingImage(
  kind: BrandingImageKind,
  actorId: string,
): Promise<BrandingView> {
  const previous = await getBrandingRow()
  const view = await upsertBranding(
    kind === 'logo'
      ? { logoKey: null, logoMime: null }
      : { faviconKey: null, faviconMime: null },
    actorId,
  )
  await deleteImageQuietly(
    kind === 'logo' ? previous?.logoKey : previous?.faviconKey,
  )
  return view
}

export async function resetBranding(actorId: string): Promise<BrandingView> {
  const previous = await getBrandingRow()
  const view = await upsertBranding(
    {
      appName: null,
      logoKey: null,
      logoMime: null,
      faviconKey: null,
      faviconMime: null,
      accentColor: null,
      font: null,
      emailFromName: null,
    },
    actorId,
  )
  await deleteImageQuietly(previous?.logoKey)
  await deleteImageQuietly(previous?.faviconKey)
  return view
}

async function deleteImageQuietly(key: string | null | undefined) {
  if (!key) return
  try {
    await getStorage().delete(key)
  } catch (err) {
    console.warn(`[areca] could not delete branding image ${key}`, err)
  }
}
