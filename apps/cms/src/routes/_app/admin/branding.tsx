import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'

import { errorMessage } from '#/components/admin/helpers'
import { TableSkeleton } from '#/components/admin/table-skeleton'
import { BrandMark } from '#/components/brand-mark'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { FormField } from '#/components/ui/form-field'
import { PageHeader } from '#/components/ui/page-header'
import { PageSection, SectionedPage } from '#/components/section-nav'
import { SaveBar } from '#/components/save-bar'
import { QueryError } from '#/components/ui/query-error'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { EntityIcon } from '#/components/entity-icon'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  BRAND_COLOR_KEYS,
  BRAND_PRESETS,
  DEFAULT_APP_NAME,
  DEFAULT_FONT,
  FONTS,
  FONT_KEYS,
  brandingPreviewStyle,
  fontStylesheetUrl,
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
import {
  Check,
  Globe,
  ArrowCounterClockwise,
  UploadSimple,
  X,
} from '@phosphor-icons/react'

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
  const activePreset = matchPreset(accentHex, font)
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
              <ArrowCounterClockwise />
              {m.admin_branding_reset_label()}
            </Button>
          </ConfirmDialog>
        }
      />

      <SectionedPage
        links={[
          { id: 'identity', label: m.admin_branding_identity() },
          { id: 'appearance', label: m.admin_branding_appearance() },
          { id: 'email', label: m.admin_branding_email_section() },
        ]}
        aside={<BrandingPreview branding={preview} />}
      >
        <form className="grid gap-8" onSubmit={onSubmit}>
          <PageSection
            id="identity"
            title={m.admin_branding_identity()}
            description={m.admin_branding_identity_description()}
          >
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
          </PageSection>

          <PageSection
            id="appearance"
            title={m.admin_branding_appearance()}
            description={m.admin_branding_appearance_description()}
          >
            <FormField
              label={m.admin_branding_preset()}
              hint={m.admin_branding_preset_hint()}
            >
              <div className="flex flex-wrap gap-2" data-testid="brand-presets">
                {/* Each chip previews its own font, so load them all here. */}
                {BRAND_PRESETS.map((preset) => {
                  const url = fontStylesheetUrl(preset.font)
                  return url ? (
                    <link key={preset.id} rel="stylesheet" href={url} />
                  ) : null
                })}
                {BRAND_PRESETS.map((preset) => {
                  const active = activePreset?.id === preset.id
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      data-testid={`brand-preset-${preset.id}`}
                      aria-pressed={active}
                      onClick={() => {
                        setAccent(preset.accent ?? '')
                        setFont(preset.font)
                      }}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-ds-label-sm transition-colors ${
                        active
                          ? 'border-border-strong bg-background-subtle text-text-primary'
                          : 'border-border-default text-text-secondary hover:bg-surface-state-hover'
                      }`}
                    >
                      <span
                        aria-hidden
                        className="size-3.5 rounded-full border border-border-subtle"
                        style={{
                          background:
                            preset.accent ?? 'var(--color-action-primary)',
                        }}
                      />
                      <span style={{ fontFamily: FONTS[preset.font].family }}>
                        {preset.label}
                      </span>
                      {active ? <Check className="size-3.5" /> : null}
                    </button>
                  )
                })}
              </div>
            </FormField>

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
                  value={accentHex ?? '#39af46'}
                  onChange={(event) => setAccent(event.target.value)}
                />
                <Input
                  id="brand-accent"
                  data-testid="brand-accent"
                  className="font-mono"
                  placeholder="#39af46"
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

            {advancedEnabled ? (
              <div
                className="grid gap-2 border-t border-border-subtle pt-5"
                data-testid="brand-legacy-colors"
              >
                <p className="text-ds-label-sm text-text-primary">
                  {m.admin_branding_legacy_title()}
                </p>
                <p className="text-ds-body-xs text-text-muted">
                  {m.admin_branding_legacy_hint()}
                </p>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="brand-legacy-clear"
                    onClick={() => {
                      setAdvancedEnabled(false)
                      setAdvancedColors({ light: {}, dark: {} })
                    }}
                  >
                    {m.admin_branding_legacy_clear()}
                  </Button>
                </div>
              </div>
            ) : null}
          </PageSection>

          <PageSection
            id="email"
            title={m.admin_branding_email_section()}
            description={m.admin_branding_email_description()}
          >
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
          </PageSection>

          <SaveBar
            dirty={dirty}
            saving={saveMutation.isPending}
            testId="save-branding"
            label={m.admin_branding_save()}
          />
        </form>
      </SectionedPage>
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
          <UploadSimple />
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

function BrandingPreview({ branding }: { branding: BrandingView }) {
  const fontUrl = fontStylesheetUrl(branding.font)

  return (
    <aside
      className="grid content-start gap-3"
      aria-label={m.admin_branding_preview_aria()}
    >
      {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
      <h2 className="text-ds-heading-5 text-text-primary">
        {m.admin_branding_preview()}
      </h2>
      <PreviewPanel
        branding={branding}
        mode="light"
        testId="branding-preview"
      />
      <PreviewPanel
        branding={branding}
        mode="dark"
        testId="branding-preview-dark"
      />
      <p className="text-ds-body-xs text-text-muted">
        {m.admin_branding_preview_footnote()}
      </p>
    </aside>
  )
}

/**
 * One mode of the preview. It renders the real components rather than
 * look-alikes, so anything the tokens break shows up here first.
 */
function PreviewPanel({
  branding,
  mode,
  testId,
}: {
  branding: BrandingView
  mode: PaletteMode
  testId: string
}) {
  return (
    <div
      data-testid={testId}
      data-theme={mode}
      // `.light` / `.dark` re-declare the whole token set on this element, so
      // both modes render correctly whatever theme the page itself is in.
      className={`${mode} grid gap-4 rounded-surface border border-border-default bg-background-default p-4 text-text-primary`}
      style={{
        ...brandingPreviewStyle(branding, mode),
        fontFamily: FONTS[branding.font].family,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <BrandMark branding={branding} />
        <span className="text-ds-label-sm text-text-muted">
          {mode === 'dark'
            ? m.admin_branding_dark_palette()
            : m.admin_branding_light_palette()}
        </span>
      </div>

      <div className="flex items-center gap-5 border-b border-border-subtle">
        <span className="nav-tab h-10" data-state="active">
          {m.admin_branding_preview_tab_active()}
        </span>
        <span className="nav-tab h-10">
          {m.admin_branding_preview_tab_idle()}
        </span>
      </div>

      <p className="text-ds-body-sm text-text-secondary">
        {m.admin_branding_pangram_before()}
        <a
          href="#preview"
          className="text-text-accent underline underline-offset-4"
          onClick={(e) => e.preventDefault()}
        >
          {m.admin_branding_pangram_link()}
        </a>
        .
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm">
          {m.admin_branding_primary_action()}
        </Button>
        <Button type="button" size="sm" variant="secondary">
          {m.admin_branding_secondary()}
        </Button>
        <Button type="button" size="sm" variant="ghost">
          {m.admin_branding_preview_ghost()}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">{m.admin_branding_preview_badge()}</Badge>
        <Badge variant="secondary">
          {m.admin_branding_preview_badge_muted()}
        </Badge>
      </div>

      <div className="flex items-center gap-3">
        <EntityIcon icon={Globe} />
        <Input
          readOnly
          className="h-9"
          aria-label={m.admin_branding_preview_input()}
          value={m.admin_branding_preview_input_value()}
        />
      </div>
    </div>
  )
}
