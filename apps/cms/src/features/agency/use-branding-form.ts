import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { errorMessage } from '#/lib/admin/helpers'
import {
  BRAND_COLOR_KEYS,
  DEFAULT_APP_NAME,
  DEFAULT_FONT,
  isFontKey,
  matchPreset,
  normalizeHex,
} from '#/lib/branding'
import type { AdvancedBrandColors, BrandingView, FontKey } from '#/lib/branding'
import { m } from '#/paraglide/messages'
import {
  clearBrandingImageFn,
  getBrandingFn,
  resetBrandingFn,
  updateBrandingFn,
} from '#/server/fn/branding'

const brandingQueryKey = ['branding'] as const

export type ImageKind = 'logo' | 'favicon'

function cloneAdvancedColors(colors: AdvancedBrandColors): AdvancedBrandColors {
  return { light: { ...colors.light }, dark: { ...colors.dark } }
}

/** Keep only valid hex values, normalised. */
function normalizedPalette(colors: AdvancedBrandColors) {
  const result: AdvancedBrandColors = { light: {}, dark: {} }
  for (const mode of ['light', 'dark'] as const) {
    for (const key of BRAND_COLOR_KEYS) {
      const value = colors[mode][key]
      if (!value) continue
      const hex = normalizeHex(value)
      if (hex) result[mode][key] = hex
    }
  }
  return result
}

async function uploadBrandingImage(kind: ImageKind, file: File) {
  const body = new FormData()
  body.append('file', file)
  body.append('kind', kind)
  const response = await fetch('/api/admin/branding/upload', {
    method: 'POST',
    body,
  })
  if (!response.ok) {
    throw new Error((await response.text()) || m.admin_branding_upload_failed())
  }
  const view: BrandingView = await response.json()
  return view
}

/**
 * Branding form state (brief §3.11, §4.1): name, sender, accent, font and
 * the legacy per-colour overrides are edited as a draft and saved together;
 * logo and favicon upload and remove immediately. Every save re-runs the
 * root loader so the whole app (and the tab title) picks the change up.
 */
export function useBrandingForm() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: brandingQueryKey,
    queryFn: () => getBrandingFn(),
  })
  const saved = query.data

  const [appName, setAppName] = React.useState('')
  const [emailFromName, setEmailFromName] = React.useState('')
  const [accent, setAccent] = React.useState('')
  const [font, setFont] = React.useState<FontKey>(DEFAULT_FONT)
  const [advancedEnabled, setAdvancedEnabled] = React.useState(false)
  const [advancedColors, setAdvancedColors] =
    React.useState<AdvancedBrandColors>({
      light: {},
      dark: {},
    })

  const seed = React.useCallback((view: BrandingView) => {
    setAppName(view.appName === DEFAULT_APP_NAME ? '' : view.appName)
    setEmailFromName(view.emailFromName ?? '')
    setAccent(view.accentColor ?? '')
    setFont(isFontKey(view.font) ? view.font : DEFAULT_FONT)
    setAdvancedEnabled(view.advancedColorsEnabled)
    setAdvancedColors(cloneAdvancedColors(view.advancedColors))
  }, [])

  // Seed from the saved values, and again after each save.
  React.useEffect(() => {
    if (saved) seed(saved)
  }, [saved, seed])

  async function applySaved(next: BrandingView) {
    queryClient.setQueryData(brandingQueryKey, next)
    await router.invalidate()
  }

  const save = useMutation({
    mutationFn: () =>
      updateBrandingFn({
        data: {
          appName: appName.trim() || null,
          emailFromName: emailFromName.trim() || null,
          accentColor: accent.trim() || null,
          advancedColorsEnabled: advancedEnabled,
          advancedColors: normalizedPalette(advancedColors),
          font,
        },
      }),
    onSuccess: async (next) => {
      toast.success(m.admin_branding_toast_saved())
      await applySaved(next)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const upload = useMutation({
    mutationFn: ({ kind, file }: { kind: ImageKind; file: File }) =>
      uploadBrandingImage(kind, file),
    onSuccess: async (next, { kind }) => {
      toast.success(
        kind === 'logo'
          ? m.admin_branding_toast_logo_updated()
          : m.admin_branding_toast_favicon_updated(),
      )
      await applySaved(next)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const clearImage = useMutation({
    mutationFn: (kind: ImageKind) => clearBrandingImageFn({ data: { kind } }),
    onSuccess: async (next, kind) => {
      toast.success(
        kind === 'logo'
          ? m.admin_branding_toast_logo_removed()
          : m.admin_branding_toast_favicon_removed(),
      )
      await applySaved(next)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const reset = useMutation({
    mutationFn: () => resetBrandingFn(),
    onSuccess: async (next) => {
      toast.success(m.admin_branding_toast_reset())
      await applySaved(next)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const accentHex = accent.trim() ? normalizeHex(accent) : null
  const accentInvalid = accent.trim().length > 0 && !accentHex
  const advancedInvalid = BRAND_COLOR_KEYS.some((key) =>
    (['light', 'dark'] as const).some((mode) => {
      const value = advancedColors[mode][key]
      return Boolean(value && !normalizeHex(value))
    }),
  )
  const normalizedAdvanced = normalizedPalette(advancedColors)

  const dirty = saved
    ? (appName.trim() || DEFAULT_APP_NAME) !== saved.appName ||
      (emailFromName.trim() || null) !== saved.emailFromName ||
      (accentHex ?? null) !== saved.accentColor ||
      advancedEnabled !== saved.advancedColorsEnabled ||
      JSON.stringify(normalizedAdvanced) !==
        JSON.stringify(normalizedPalette(saved.advancedColors)) ||
      font !== saved.font
    : false

  const preview: BrandingView | null = saved
    ? {
        ...saved,
        appName: appName.trim() || DEFAULT_APP_NAME,
        accentColor: accentHex,
        advancedColorsEnabled: advancedEnabled,
        advancedColors: normalizedAdvanced,
        font,
      }
    : null

  function submit() {
    if (accentInvalid || advancedInvalid) {
      toast.error(m.admin_branding_accent_invalid_toast())
      return
    }
    save.mutate()
  }

  return {
    query,
    saved,
    preview,
    fields: { appName, emailFromName, accent, font, advancedEnabled },
    set: { setAppName, setEmailFromName, setAccent, setFont },
    accentHex,
    accentInvalid,
    activePreset: matchPreset(accentHex, font),
    dirty,
    busy:
      save.isPending ||
      upload.isPending ||
      clearImage.isPending ||
      reset.isPending,
    save,
    submit,
    discard: () => saved && seed(saved),
    upload,
    clearImage,
    reset,
    removeLegacyColors: () => {
      setAdvancedEnabled(false)
      setAdvancedColors({ light: {}, dark: {} })
    },
  }
}
