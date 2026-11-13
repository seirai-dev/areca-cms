import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import {
  BRAND_COLOR_KEYS,
  DEFAULT_APP_NAME,
  DEFAULT_FONT,
  isFontKey,
  matchPreset,
  normalizeHex,
  normalizeLoginTaglines,
} from '#/lib/branding'
import type {
  AdvancedBrandColors,
  BrandingView,
  FontKey,
  LoginTaglineLocale,
} from '#/lib/branding'
import { errorMessage } from '#/lib/errors'
import { queryKeys } from '#/lib/query-keys'
import { m } from '#/paraglide/messages'
import {
  clearBrandingImageFn,
  getBrandingFn,
  resetBrandingFn,
  updateBrandingFn,
} from '#/server/fn/branding'

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

/** The fields edited as a draft and saved together. */
type BrandingDraft = {
  appName: string
  emailFromName: string
  loginTagline: Record<LoginTaglineLocale, string>
  accent: string
  font: FontKey
  advancedEnabled: boolean
  advancedColors: AdvancedBrandColors
}

function draftFrom(view: BrandingView): BrandingDraft {
  return {
    appName: view.appName === DEFAULT_APP_NAME ? '' : view.appName,
    emailFromName: view.emailFromName ?? '',
    loginTagline: {
      en: view.loginTagline.en ?? '',
      nl: view.loginTagline.nl ?? '',
      tr: view.loginTagline.tr ?? '',
    },
    accent: view.accentColor ?? '',
    font: isFontKey(view.font) ? view.font : DEFAULT_FONT,
    advancedEnabled: view.advancedColorsEnabled,
    advancedColors: cloneAdvancedColors(view.advancedColors),
  }
}

export function useBrandingQuery() {
  return useQuery({
    queryKey: queryKeys.branding(),
    queryFn: () => getBrandingFn(),
  })
}

/**
 * Branding form state (brief §3.11, §4.1): name, sender, accent, font and
 * the legacy per-colour overrides are edited as a draft and saved together;
 * logo and favicon upload and remove immediately. Every save re-runs the
 * root loader so the whole app (and the tab title) picks the change up.
 */
export function useBrandingForm(saved: BrandingView) {
  const router = useRouter()
  const queryClient = useQueryClient()

  // Starts from the branding loaded when the form mounts. Image uploads change
  // `saved` but must not overwrite the draft, so only save, reset and discard
  // start it again.
  const [draft, setDraft] = React.useState(() => draftFrom(saved))
  const seed = (view: BrandingView) => setDraft(draftFrom(view))
  const patch = (next: Partial<BrandingDraft>) =>
    setDraft((current) => ({ ...current, ...next }))
  const {
    appName,
    emailFromName,
    loginTagline,
    accent,
    font,
    advancedEnabled,
    advancedColors,
  } = draft

  async function applySaved(next: BrandingView) {
    queryClient.setQueryData(queryKeys.branding(), next)
    await router.invalidate()
  }

  const save = useMutation({
    mutationFn: () =>
      updateBrandingFn({
        data: {
          appName: appName.trim() || null,
          emailFromName: emailFromName.trim() || null,
          loginTagline: normalizeLoginTaglines(loginTagline),
          accentColor: accent.trim() || null,
          advancedColorsEnabled: advancedEnabled,
          advancedColors: normalizedPalette(advancedColors),
          font,
        },
      }),
    onSuccess: async (next) => {
      seed(next)
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
      seed(next)
      toast.success(m.admin_branding_toast_reset())
      await applySaved(next)
    },
    // Only the reset dialog runs it; the dialog shows the error.
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
  const normalizedLoginTagline = normalizeLoginTaglines(loginTagline)

  const dirty =
    (appName.trim() || DEFAULT_APP_NAME) !== saved.appName ||
    (emailFromName.trim() || null) !== saved.emailFromName ||
    JSON.stringify(normalizedLoginTagline) !==
      JSON.stringify(saved.loginTagline) ||
    (accentHex ?? null) !== saved.accentColor ||
    advancedEnabled !== saved.advancedColorsEnabled ||
    JSON.stringify(normalizedAdvanced) !==
      JSON.stringify(normalizedPalette(saved.advancedColors)) ||
    font !== saved.font

  const preview: BrandingView = {
    ...saved,
    appName: appName.trim() || DEFAULT_APP_NAME,
    accentColor: accentHex,
    advancedColorsEnabled: advancedEnabled,
    advancedColors: normalizedAdvanced,
    font,
    loginTagline: normalizedLoginTagline,
  }

  function submit() {
    if (accentInvalid || advancedInvalid) {
      toast.error(m.admin_branding_accent_invalid_toast())
      return
    }
    save.mutate()
  }

  return {
    saved,
    preview,
    fields: {
      appName,
      emailFromName,
      loginTagline,
      accent,
      font,
      advancedEnabled,
    },
    set: {
      setAppName: (value: string) => patch({ appName: value }),
      setEmailFromName: (value: string) => patch({ emailFromName: value }),
      setLoginTagline: (locale: LoginTaglineLocale, value: string) =>
        setDraft((current) => ({
          ...current,
          loginTagline: { ...current.loginTagline, [locale]: value },
        })),
      setAccent: (value: string) => patch({ accent: value }),
      setFont: (value: FontKey) => patch({ font: value }),
    },
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
    discard: () => seed(saved),
    upload,
    clearImage,
    reset,
    removeLegacyColors: () =>
      patch({
        advancedEnabled: false,
        advancedColors: { light: {}, dark: {} },
      }),
  }
}
