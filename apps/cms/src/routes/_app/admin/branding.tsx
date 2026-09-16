import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { AlertTriangle, RotateCcw, Upload, X } from 'lucide-react'
import { toast } from 'sonner'

import { errorMessage } from '#/components/admin/helpers'
import { TableSkeleton } from '#/components/admin/table-skeleton'
import { BrandLogo, BrandMark } from '#/components/brand-mark'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { FormField } from '#/components/form-field'
import { PageHeader } from '#/components/page-header'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import {
  BRAND_COLOR_KEYS,
  DEFAULT_APP_NAME,
  DEFAULT_FONT,
  FONTS,
  FONT_KEYS,
  brandingPreviewStyle,
  contrastRatio,
  fontStylesheetUrl,
  normalizeHex,
} from '#/lib/branding'
import type {
  AdvancedBrandColors,
  BrandColorKey,
  BrandColorPalette,
  BrandingView,
  FontKey,
} from '#/lib/branding'
import { m } from '#/paraglide/messages'
import {
  clearBrandingImageFn,
  getBrandingFn,
  resetBrandingFn,
  updateBrandingFn,
} from '#/server/fn/branding'

export const Route = createFileRoute('/_app/admin/branding')({
  component: BrandingPage,
})

const brandingQueryKey = ['branding'] as const

type ImageKind = 'logo' | 'favicon'
type PaletteMode = keyof AdvancedBrandColors

function cloneAdvancedColors(colors: AdvancedBrandColors): AdvancedBrandColors {
  return { light: { ...colors.light }, dark: { ...colors.dark } }
}

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

function BrandingPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const getBranding = useServerFn(getBrandingFn)
  const updateBranding = useServerFn(updateBrandingFn)
  const clearImage = useServerFn(clearBrandingImageFn)
  const resetBranding = useServerFn(resetBrandingFn)

  const brandingQuery = useQuery({
    queryKey: brandingQueryKey,
    queryFn: () => getBranding(),
  })
  const saved = brandingQuery.data

  const [appName, setAppName] = useState('')
  const [emailFromName, setEmailFromName] = useState('')
  const [accent, setAccent] = useState('')
  const [font, setFont] = useState<FontKey>(DEFAULT_FONT)
  const [advancedEnabled, setAdvancedEnabled] = useState(false)
  const [advancedColors, setAdvancedColors] = useState<AdvancedBrandColors>({
    light: {},
    dark: {},
  })
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('light')

  // Seed the form from the saved values, and again after each save.
  useEffect(() => {
    if (!saved) return
    setAppName(saved.appName === DEFAULT_APP_NAME ? '' : saved.appName)
    setEmailFromName(saved.emailFromName ?? '')
    setAccent(saved.accentColor ?? '')
    setFont(saved.font)
    setAdvancedEnabled(saved.advancedColorsEnabled)
    setAdvancedColors(cloneAdvancedColors(saved.advancedColors))
  }, [saved])

  async function applySaved(next: BrandingView) {
    queryClient.setQueryData(brandingQueryKey, next)
    await router.invalidate()
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      updateBranding({
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

  const uploadMutation = useMutation({
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

  const clearMutation = useMutation({
    mutationFn: (kind: ImageKind) => clearImage({ data: { kind } }),
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

  const resetMutation = useMutation({
    mutationFn: () => resetBranding(),
    onSuccess: async (next) => {
      toast.success(m.admin_branding_toast_reset())
      await applySaved(next)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (brandingQuery.isError) {
    return (
      <div className="grid gap-6">
        <QueryError
          title={m.admin_branding_load_error()}
          error={brandingQuery.error}
          onRetry={() => void brandingQuery.refetch()}
          retrying={brandingQuery.isFetching}
        />
      </div>
    )
  }

  if (!saved) {
    return (
      <div className="grid gap-6">
        <TableSkeleton columns={2} />
      </div>
    )
  }

  const accentHex = accent.trim() ? normalizeHex(accent) : null
  const accentInvalid = accent.trim().length > 0 && !accentHex
  const advancedInvalid = BRAND_COLOR_KEYS.some((key) =>
    (['light', 'dark'] as const).some((mode) => {
      const value = advancedColors[mode][key]
      return Boolean(value && !normalizeHex(value))
    }),
  )
  const normalizedAdvancedColors = normalizedPalette(advancedColors)

  const dirty =
    (appName.trim() || DEFAULT_APP_NAME) !== saved.appName ||
    (emailFromName.trim() || null) !== saved.emailFromName ||
    (accentHex ?? null) !== saved.accentColor ||
    advancedEnabled !== saved.advancedColorsEnabled ||
    JSON.stringify(normalizedAdvancedColors) !==
      JSON.stringify(normalizedPalette(saved.advancedColors)) ||
    font !== saved.font

  const preview: BrandingView = {
    ...saved,
    appName: appName.trim() || DEFAULT_APP_NAME,
    accentColor: accentHex,
    advancedColorsEnabled: advancedEnabled,
    advancedColors: normalizedAdvancedColors,
    font,
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (accentInvalid || advancedInvalid) {
      toast.error(m.admin_branding_accent_invalid_toast())
      return
    }
    saveMutation.mutate()
  }

  const busy =
    saveMutation.isPending ||
    uploadMutation.isPending ||
    clearMutation.isPending ||
    resetMutation.isPending

  function setAdvancedColor(
    mode: PaletteMode,
    key: BrandColorKey,
    value: string,
  ) {
    setAdvancedColors((current) => ({
      ...current,
      [mode]: { ...current[mode], [key]: value },
    }))
  }

  return (
    <div className="grid gap-6" data-testid="branding-page" data-ready="true">
      <PageHeader
        title={m.admin_branding_title()}
        description={m.admin_branding_description()}
        actions={
          <ConfirmDialog
            title={m.admin_branding_reset_title()}
            description={m.admin_branding_reset_description()}
            confirmLabel={m.admin_branding_reset_label()}
            variant="destructive"
            onConfirm={async () => {
              await resetMutation.mutateAsync()
            }}
            testId="reset-branding"
          >
            <Button
              type="button"
              variant="outline"
              disabled={busy || !saved.customized}
            >
              <RotateCcw />
              {m.admin_branding_reset_label()}
            </Button>
          </ConfirmDialog>
        }
      />

      <div
        className={`grid gap-8 ${
          advancedEnabled
            ? 'lg:grid-cols-[minmax(0,36rem)_minmax(0,1fr)]'
            : 'lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]'
        }`}
      >
        <form className="grid gap-6" onSubmit={onSubmit}>
          <section className="grid gap-4">
            <h2 className="text-lg font-medium">
              {m.admin_branding_identity()}
            </h2>
            <FormField
              label={m.admin_name()}
              htmlFor="brand-name"
              hint={m.admin_branding_name_hint({ name: DEFAULT_APP_NAME })}
            >
              <Input
                id="brand-name"
                data-testid="brand-name"
                maxLength={60}
                placeholder={DEFAULT_APP_NAME}
                value={appName}
                onChange={(event) => setAppName(event.target.value)}
              />
            </FormField>

            <ImageField
              kind="logo"
              label={m.admin_branding_logo()}
              hint={m.admin_branding_logo_hint()}
              accept="image/png,image/jpeg,image/webp,image/gif"
              url={saved.logoUrl}
              busy={busy}
              onPick={(file) => uploadMutation.mutate({ kind: 'logo', file })}
              onClear={() => clearMutation.mutate('logo')}
            />

            <ImageField
              kind="favicon"
              label={m.admin_branding_favicon()}
              hint={m.admin_branding_favicon_hint()}
              accept="image/png,image/x-icon,image/vnd.microsoft.icon,.ico"
              url={saved.faviconUrl}
              busy={busy}
              onPick={(file) =>
                uploadMutation.mutate({ kind: 'favicon', file })
              }
              onClear={() => clearMutation.mutate('favicon')}
            />
          </section>

          <section className="grid gap-4">
            <h2 className="text-lg font-medium">
              {m.admin_branding_appearance()}
            </h2>
            <FormField
              label={m.admin_branding_accent()}
              htmlFor="brand-accent"
              hint={m.admin_branding_accent_hint()}
              error={
                accentInvalid ? m.admin_branding_accent_error() : undefined
              }
            >
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={m.admin_branding_accent_pick_aria()}
                  className="size-9 shrink-0 cursor-pointer rounded-md border bg-background p-1"
                  value={accentHex ?? '#3d5a3a'}
                  onChange={(event) => setAccent(event.target.value)}
                />
                <Input
                  id="brand-accent"
                  data-testid="brand-accent"
                  className="font-mono"
                  placeholder="#3d5a3a"
                  maxLength={7}
                  value={accent}
                  onChange={(event) => setAccent(event.target.value)}
                />
                {accent ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={m.admin_branding_accent_clear_aria()}
                    onClick={() => setAccent('')}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            </FormField>

            <FormField label={m.admin_branding_font()} htmlFor="brand-font">
              <Select
                value={font}
                onValueChange={(value) => setFont(value as FontKey)}
              >
                <SelectTrigger id="brand-font" data-testid="brand-font">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {key === 'system'
                        ? m.admin_font_system_default()
                        : FONTS[key].label}
                      {key === DEFAULT_FONT
                        ? m.admin_branding_font_default_suffix()
                        : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <div className="grid gap-3 rounded-md border p-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="brand-advanced"
                  data-testid="brand-advanced"
                  checked={advancedEnabled}
                  onCheckedChange={(checked) => {
                    const enabled = checked === true
                    setAdvancedEnabled(enabled)
                    if (!enabled) setPaletteMode('light')
                  }}
                />
                <div className="grid gap-1">
                  <Label htmlFor="brand-advanced" className="cursor-pointer">
                    {m.admin_branding_advanced()}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {m.admin_branding_advanced_hint()}
                  </p>
                </div>
              </div>

              {advancedEnabled ? (
                <Tabs
                  value={paletteMode}
                  onValueChange={(value) =>
                    setPaletteMode(value as PaletteMode)
                  }
                >
                  <TabsList>
                    <TabsTrigger value="light">
                      {m.admin_branding_light_palette()}
                    </TabsTrigger>
                    <TabsTrigger value="dark">
                      {m.admin_branding_dark_palette()}
                    </TabsTrigger>
                  </TabsList>
                  {(['light', 'dark'] as const).map((mode) => (
                    <TabsContent key={mode} value={mode} className="mt-3">
                      <AdvancedPaletteFields
                        mode={mode}
                        colors={advancedColors[mode]}
                        onChange={(key, value) =>
                          setAdvancedColor(mode, key, value)
                        }
                      />
                    </TabsContent>
                  ))}
                </Tabs>
              ) : null}
            </div>
          </section>

          <section className="grid gap-4">
            <h2 className="text-lg font-medium">
              {m.admin_branding_email_section()}
            </h2>
            <FormField
              label={m.admin_branding_sender_name()}
              htmlFor="brand-email-from"
              hint={m.admin_branding_sender_hint()}
            >
              <Input
                id="brand-email-from"
                data-testid="brand-email-from"
                maxLength={80}
                placeholder={appName.trim() || DEFAULT_APP_NAME}
                value={emailFromName}
                onChange={(event) => setEmailFromName(event.target.value)}
              />
            </FormField>
          </section>

          <div>
            <Button
              type="submit"
              data-testid="save-branding"
              disabled={busy || !dirty || accentInvalid || advancedInvalid}
            >
              {saveMutation.isPending
                ? m.admin_saving()
                : m.admin_branding_save()}
            </Button>
          </div>
        </form>

        <BrandingPreview branding={preview} mode={paletteMode} />
      </div>
    </div>
  )
}

const COLOR_GROUPS: Array<{
  title: () => string
  fields: BrandColorKey[]
}> = [
  {
    title: () => m.admin_branding_group_foundations(),
    fields: ['background', 'foreground', 'surface', 'surfaceForeground'],
  },
  {
    title: () => m.admin_branding_group_subtle(),
    fields: [
      'muted',
      'mutedForeground',
      'accent',
      'accentForeground',
      'border',
      'input',
    ],
  },
  {
    title: () => m.admin_branding_group_actions(),
    fields: [
      'primary',
      'primaryForeground',
      'secondary',
      'secondaryForeground',
      'link',
      'ring',
    ],
  },
  {
    title: () => m.admin_branding_group_sidebar(),
    fields: [
      'sidebar',
      'sidebarForeground',
      'sidebarPrimary',
      'sidebarPrimaryForeground',
      'sidebarAccent',
      'sidebarAccentForeground',
    ],
  },
]

const CONTRAST_PAIRS: Array<readonly [BrandColorKey, BrandColorKey]> = [
  ['foreground', 'background'],
  ['surfaceForeground', 'surface'],
  ['mutedForeground', 'muted'],
  ['accentForeground', 'accent'],
  ['primaryForeground', 'primary'],
  ['secondaryForeground', 'secondary'],
  ['sidebarForeground', 'sidebar'],
  ['sidebarPrimaryForeground', 'sidebarPrimary'],
  ['sidebarAccentForeground', 'sidebarAccent'],
]

function colorLabel(key: BrandColorKey) {
  const labels: Record<BrandColorKey, () => string> = {
    background: m.admin_branding_color_background,
    foreground: m.admin_branding_color_foreground,
    surface: m.admin_branding_color_surface,
    surfaceForeground: m.admin_branding_color_surface_foreground,
    muted: m.admin_branding_color_muted,
    mutedForeground: m.admin_branding_color_muted_foreground,
    accent: m.admin_branding_color_accent,
    accentForeground: m.admin_branding_color_accent_foreground,
    border: m.admin_branding_color_border,
    input: m.admin_branding_color_input,
    primary: m.admin_branding_color_primary,
    primaryForeground: m.admin_branding_color_primary_foreground,
    secondary: m.admin_branding_color_secondary,
    secondaryForeground: m.admin_branding_color_secondary_foreground,
    link: m.admin_branding_color_link,
    ring: m.admin_branding_color_ring,
    sidebar: m.admin_branding_color_sidebar,
    sidebarForeground: m.admin_branding_color_sidebar_foreground,
    sidebarPrimary: m.admin_branding_color_sidebar_primary,
    sidebarPrimaryForeground: m.admin_branding_color_sidebar_primary_foreground,
    sidebarAccent: m.admin_branding_color_sidebar_accent,
    sidebarAccentForeground: m.admin_branding_color_sidebar_accent_foreground,
  }
  return labels[key]()
}

function pickerFallback(mode: PaletteMode, key: BrandColorKey) {
  if (key.endsWith('Foreground') || key === 'foreground' || key === 'link') {
    return mode === 'light' ? '#2f2925' : '#eee9e5'
  }
  if (key === 'primary' || key === 'sidebarPrimary' || key === 'ring') {
    return mode === 'light' ? '#3d5a3a' : '#7ca275'
  }
  return mode === 'light' ? '#f4efeb' : '#272320'
}

function AdvancedPaletteFields({
  mode,
  colors,
  onChange,
}: {
  mode: PaletteMode
  colors: BrandColorPalette
  onChange: (key: BrandColorKey, value: string) => void
}) {
  const warnings = CONTRAST_PAIRS.flatMap(([foreground, background]) => {
    const foregroundValue = colors[foreground]
    const backgroundValue = colors[background]
    if (!foregroundValue || !backgroundValue) return []
    const ratio = contrastRatio(foregroundValue, backgroundValue)
    return ratio !== null && ratio < 4.5
      ? [{ foreground, background, ratio }]
      : []
  })

  return (
    <div className="grid gap-5" data-testid={`brand-${mode}-palette`}>
      <p className="text-xs text-muted-foreground">
        {m.admin_branding_palette_hint()}
      </p>
      {COLOR_GROUPS.map((group) => (
        <fieldset key={group.title()} className="grid gap-3">
          <legend className="mb-1 text-sm font-medium">{group.title()}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {group.fields.map((key) => {
              const value = colors[key] ?? ''
              const normalized = value ? normalizeHex(value) : null
              const invalid = Boolean(value && !normalized)
              const label = colorLabel(key)
              return (
                <FormField
                  key={key}
                  label={label}
                  htmlFor={`brand-${mode}-${key}`}
                  error={invalid ? m.admin_branding_color_invalid() : undefined}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label={m.admin_branding_color_pick_aria({ label })}
                      className="size-9 shrink-0 cursor-pointer rounded-md border bg-background p-1"
                      value={normalized ?? pickerFallback(mode, key)}
                      onChange={(event) => onChange(key, event.target.value)}
                    />
                    <Input
                      id={`brand-${mode}-${key}`}
                      data-testid={`brand-${mode}-${key}`}
                      className="font-mono"
                      placeholder={m.admin_branding_automatic()}
                      maxLength={7}
                      aria-invalid={invalid || undefined}
                      value={value}
                      onChange={(event) => onChange(key, event.target.value)}
                    />
                    {value ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={m.admin_branding_color_clear_aria({
                          label,
                        })}
                        onClick={() => onChange(key, '')}
                      >
                        <X />
                      </Button>
                    ) : null}
                  </div>
                </FormField>
              )
            })}
          </div>
        </fieldset>
      ))}
      {warnings.length > 0 ? (
        <div
          className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3"
          role="status"
          data-testid={`brand-${mode}-contrast-warnings`}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4 text-destructive" />
            {m.admin_branding_contrast_warning_title()}
          </div>
          <ul className="grid gap-1 pl-6 text-xs text-muted-foreground">
            {warnings.map(({ foreground, background, ratio }) => (
              <li key={`${foreground}-${background}`} className="list-disc">
                {m.admin_branding_contrast_warning({
                  foreground: colorLabel(foreground),
                  background: colorLabel(background),
                  ratio: ratio.toFixed(2),
                })}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {m.admin_branding_contrast_warning_hint()}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function ImageField({
  kind,
  label,
  hint,
  accept,
  url,
  busy,
  onPick,
  onClear,
}: {
  kind: ImageKind
  label: string
  hint: string
  accept: string
  url: string | null
  busy: boolean
  onPick: (file: File) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onPick(file)
  }

  return (
    <FormField label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted">
          {url ? (
            <img
              src={url}
              alt=""
              data-testid={`brand-${kind}-preview`}
              className="size-10 object-contain"
            />
          ) : (
            <span className="text-xs text-muted-foreground">
              {m.admin_none()}
            </span>
          )}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          data-testid={`brand-${kind}-input`}
          onChange={onChange}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Upload />
          {url ? m.admin_replace() : m.admin_upload()}
        </Button>
        {url ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onClear}
          >
            {m.admin_remove()}
          </Button>
        ) : null}
      </div>
    </FormField>
  )
}

function BrandingPreview({
  branding,
  mode,
}: {
  branding: BrandingView
  mode: PaletteMode
}) {
  const fontUrl = fontStylesheetUrl(branding.font)

  return (
    <aside
      className="grid content-start gap-3"
      aria-label={m.admin_branding_preview_aria()}
    >
      {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">{m.admin_branding_preview()}</h2>
        {branding.advancedColorsEnabled ? (
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            {mode === 'dark'
              ? m.admin_branding_dark_palette()
              : m.admin_branding_light_palette()}
          </span>
        ) : null}
      </div>
      <div
        data-testid="branding-preview"
        data-theme={mode}
        className={`${mode === 'dark' ? 'dark' : ''} grid gap-5 rounded-md border bg-background p-5 text-foreground`}
        style={{
          ...brandingPreviewStyle(branding, mode),
          fontFamily: FONTS[branding.font].family,
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <BrandMark branding={branding} />
          <span className="text-xs text-muted-foreground">
            {branding.font === 'system'
              ? m.admin_font_system_default()
              : FONTS[branding.font].label}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {m.admin_branding_pangram_before()}
          <a
            href="#preview"
            className="text-link"
            onClick={(e) => e.preventDefault()}
          >
            {m.admin_branding_pangram_link()}
          </a>
          .
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button">{m.admin_branding_primary_action()}</Button>
          <Button type="button" variant="secondary">
            {m.admin_branding_secondary()}
          </Button>
          <Button type="button" variant="outline">
            {m.admin_branding_outline()}
          </Button>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-sidebar px-3 py-2 text-sm text-sidebar-foreground shadow-[inset_3px_0_0_var(--sidebar-primary)]">
          <BrandLogo branding={branding} className="size-6" />
          {m.admin_branding_active_sidebar()}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {m.admin_branding_preview_footnote()}
      </p>
    </aside>
  )
}
