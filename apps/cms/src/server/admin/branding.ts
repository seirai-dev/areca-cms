import { eq } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'

import { getStorage } from '#/adapters'
import { db } from '#/db'
import { branding } from '#/db/schema'
import {
  BRAND_COLOR_KEYS,
  DEFAULT_APP_NAME,
  DEFAULT_FONT,
  EMPTY_ADVANCED_COLORS,
  hasAdvancedColors,
  isFontKey,
  normalizeAdvancedColors,
  normalizeHex,
} from '#/lib/branding'
import type {
  AdvancedBrandColors,
  BrandColorPalette,
  BrandingView,
  FontKey,
} from '#/lib/branding'
import { m } from '#/paraglide/messages'
import { AssetValidationError } from '#/server/assets'
import { audit } from '#/server/audit'
import { createLogger } from '#/server/log'

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
  },
  favicon: {
    'image/png': 'png',
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
  const advancedColors = row?.advancedColors
    ? normalizeAdvancedColors(row.advancedColors)
    : EMPTY_ADVANCED_COLORS
  const view: BrandingView = {
    appName: row?.appName?.trim() || DEFAULT_APP_NAME,
    logoUrl: brandingImageUrl(row?.logoKey),
    faviconUrl: brandingImageUrl(row?.faviconKey),
    faviconMime: row?.faviconMime ?? null,
    accentColor: row?.accentColor ?? null,
    advancedColorsEnabled: row?.advancedColorsEnabled ?? false,
    advancedColors,
    font,
    emailFromName: row?.emailFromName?.trim() || null,
    customized: false,
  }
  view.customized =
    view.appName !== DEFAULT_APP_NAME ||
    view.logoUrl !== null ||
    view.faviconUrl !== null ||
    view.accentColor !== null ||
    view.advancedColorsEnabled ||
    hasAdvancedColors(view.advancedColors) ||
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
    | 'advancedColorsEnabled'
    | 'advancedColors'
    | 'font'
    | 'emailFromName'
  >
>

async function upsertBranding(
  patch: BrandingPatch,
  actorId: string,
  event: { action: string; meta?: Record<string, unknown> },
) {
  const values = { ...patch, updatedBy: actorId, updatedAt: new Date() }
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(branding)
      .values({ id: BRANDING_ID, ...values })
      .onConflictDoUpdate({ target: branding.id, set: values })
      .returning()
    const row = rows.at(0)
    if (!row) {
      throw new Error(m.server_failed_to_save_branding())
    }
    await audit(
      {
        organizationId: null,
        actorId,
        action: event.action,
        targetType: 'branding',
        targetId: BRANDING_ID,
        meta: event.meta,
      },
      tx,
    )
    return toBrandingView(row)
  })
}

export async function updateBranding(
  input: {
    appName?: string | null
    accentColor?: string | null
    advancedColorsEnabled?: boolean
    advancedColors?: AdvancedBrandColors | null
    font?: string | null
    emailFromName?: string | null
  },
  actorId: string,
): Promise<BrandingView> {
  const patch: BrandingPatch = {}

  if (input.appName !== undefined) {
    const name = input.appName?.trim() ?? ''
    if (name.length > 60) {
      throw new AssetValidationError(m.server_name_max_60())
    }
    patch.appName = name && name !== DEFAULT_APP_NAME ? name : null
  }

  if (input.accentColor !== undefined) {
    if (!input.accentColor) {
      patch.accentColor = null
    } else {
      const hex = normalizeHex(input.accentColor)
      if (!hex) {
        throw new AssetValidationError(m.server_accent_hex())
      }
      patch.accentColor = hex
    }
  }

  if (input.advancedColorsEnabled !== undefined) {
    patch.advancedColorsEnabled = input.advancedColorsEnabled
  }

  if (input.advancedColors !== undefined) {
    if (input.advancedColors === null) {
      patch.advancedColors = null
    } else {
      const normalized: AdvancedBrandColors = { light: {}, dark: {} }
      for (const mode of ['light', 'dark'] as const) {
        const palette: BrandColorPalette = {}
        for (const key of BRAND_COLOR_KEYS) {
          const value = input.advancedColors[mode][key]
          if (!value) continue
          const hex = normalizeHex(value)
          if (!hex) {
            throw new AssetValidationError(m.server_accent_hex())
          }
          palette[key] = hex
        }
        normalized[mode] = palette
      }
      patch.advancedColors = hasAdvancedColors(normalized) ? normalized : null
    }
  }

  if (input.font !== undefined) {
    if (!input.font || input.font === DEFAULT_FONT) {
      patch.font = null
    } else if (isFontKey(input.font)) {
      patch.font = input.font
    } else {
      throw new AssetValidationError(m.server_unknown_font())
    }
  }

  if (input.emailFromName !== undefined) {
    const name = input.emailFromName?.trim() ?? ''
    if (name.length > 80) {
      throw new AssetValidationError(m.server_email_sender_max_80())
    }
    patch.emailFromName = name || null
  }

  return upsertBranding(patch, actorId, {
    action: 'branding.update',
    meta: { fields: Object.keys(patch) },
  })
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
        ? m.server_logo_image_types()
        : m.server_favicon_image_types(),
    )
  }
  if (file.buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new AssetValidationError(m.server_image_exceeds_2mb())
  }

  const previous = await getBrandingRow()
  const storageKey = `branding/${kind}-${crypto.randomUUID()}.${ext}`
  await getStorage().put(storageKey, file.buffer, mimeType)

  const view = await upsertBranding(
    kind === 'logo'
      ? { logoKey: storageKey, logoMime: mimeType }
      : { faviconKey: storageKey, faviconMime: mimeType },
    actorId,
    { action: 'branding.image_set', meta: { kind } },
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
    { action: 'branding.image_clear', meta: { kind } },
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
      advancedColorsEnabled: false,
      advancedColors: null,
      font: null,
      emailFromName: null,
    },
    actorId,
    { action: 'branding.reset' },
  )
  await deleteImageQuietly(previous?.logoKey)
  await deleteImageQuietly(previous?.faviconKey)
  return view
}

const log = createLogger('branding')

async function deleteImageQuietly(key: string | null | undefined) {
  if (!key) return
  try {
    await getStorage().delete(key)
  } catch (err) {
    log.warn('could not delete branding image', { key, err })
  }
}
