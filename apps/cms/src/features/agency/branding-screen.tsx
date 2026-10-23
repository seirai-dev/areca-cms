import * as React from 'react'
import {
  ArrowCounterClockwise,
  Check,
  ImageSquare,
  Palette,
  SignIn,
  TextAa,
  UploadSimple,
  X,
} from '@phosphor-icons/react'

import { LOCALE_LABELS } from '#/components/language-switcher'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import {
  FloatingBar,
  FloatingBarDivider,
  FloatingBarLabel,
} from '#/components/ui/floating-bar'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import {
  BRAND_PRESETS,
  DEFAULT_APP_NAME,
  DEFAULT_FONT,
  FONTS,
  FONT_KEYS,
  LOGIN_TAGLINE_LOCALES,
  LOGIN_TAGLINE_MAX_LENGTH,
  fontStylesheetUrl,
} from '#/lib/branding'
import type { FontKey } from '#/lib/branding'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { BrandingPreview } from './branding-preview'
import { useBrandingForm } from './use-branding-form'
import type { ImageKind } from './use-branding-form'

/** The built-in iris (styles.css `--color-accent`), shown on the Areca swatch. */
const BUILT_IN_ACCENT = '#5856d6'

function Section({
  id,
  icon,
  title,
  description,
  children,
}: {
  id: string
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid gap-3">
      <div className="flex items-start gap-3 px-1">
        <span className="mt-0.5 grid size-7 shrink-0 place-content-center rounded-[8px] bg-background-subtle text-icon-default [&>svg]:size-4">
          {icon}
        </span>
        <div className="grid gap-0.5">
          <h2 id={`${id}-title`} className="text-headline text-text-primary">
            {title}
          </h2>
          <p className="text-callout text-text-secondary">{description}</p>
        </div>
      </div>
      <div className="grid gap-5 p-5 surface-card">{children}</div>
    </section>
  )
}

/**
 * `/agency/branding` (brief §3.11, §4.1): settings on the left (Identity,
 * Colour, Typography, Email), a sticky live preview on the right in light and
 * dark. Logo and favicon upload immediately; everything else is saved with
 * the floating save pill.
 */
export function BrandingScreen() {
  const form = useBrandingForm()
  const { saved, preview, fields, set } = form

  // Each font renders in itself, so load them all while this page is open.
  const fontLinks = FONT_KEYS.map((key) => fontStylesheetUrl(key)).filter(
    (url): url is string => Boolean(url),
  )

  const resetButton = saved ? (
    <ConfirmDialog
      title={m.admin_branding_reset_title()}
      description={m.admin_branding_reset_description()}
      confirmLabel={m.admin_branding_reset_label()}
      variant="destructive"
      onConfirm={async () => {
        await form.reset.mutateAsync()
      }}
      testId="reset-branding"
    >
      <Button
        type="button"
        variant="secondary"
        disabled={form.busy || !saved.customized}
      >
        <ArrowCounterClockwise />
        {m.admin_branding_reset_label()}
      </Button>
    </ConfirmDialog>
  ) : null

  return (
    <div
      className="grid gap-8"
      data-testid="branding-page"
      data-ready={saved ? 'true' : 'false'}
    >
      <PageHeader
        title={m.admin_branding_title()}
        description={m.agency_branding_description()}
        actions={resetButton}
      />

      {form.query.isError ? (
        <QueryError
          title={m.agency_branding_load_error()}
          error={form.query.error}
          onRetry={() => void form.query.refetch()}
          retrying={form.query.isFetching}
        />
      ) : !saved || !preview ? (
        <div
          className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_440px]"
          aria-busy="true"
        >
          <div className="grid gap-6">
            <Skeleton className="h-64 rounded-card" />
            <Skeleton className="h-48 rounded-card" />
          </div>
          <Skeleton className="h-80 rounded-card" />
        </div>
      ) : (
        <form
          className="grid items-start gap-8 pb-24 xl:grid-cols-[minmax(0,1fr)_440px]"
          onSubmit={(event) => {
            event.preventDefault()
            form.submit()
          }}
        >
          {fontLinks.map((href) => (
            <link key={href} rel="stylesheet" href={href} />
          ))}

          <div className="order-2 grid min-w-0 gap-8 xl:order-1">
            <Section
              id="identity"
              icon={<ImageSquare />}
              title={m.admin_branding_identity()}
              description={m.agency_branding_identity_description()}
            >
              <FormField
                label={m.agency_branding_app_name()}
                htmlFor="brand-name"
                hint={m.admin_branding_name_hint({ name: DEFAULT_APP_NAME })}
              >
                <Input
                  id="brand-name"
                  data-testid="brand-name"
                  maxLength={60}
                  placeholder={DEFAULT_APP_NAME}
                  value={fields.appName}
                  onChange={(event) => set.setAppName(event.target.value)}
                />
              </FormField>
              <div className="grid gap-4 border-t border-border-default pt-5 sm:grid-cols-2">
                <ImageField
                  kind="logo"
                  label={m.admin_branding_logo()}
                  hint={m.agency_branding_logo_hint()}
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  url={saved.logoUrl}
                  busy={form.busy}
                  onPick={(file) => form.upload.mutate({ kind: 'logo', file })}
                  onClear={() => form.clearImage.mutate('logo')}
                />
                <ImageField
                  kind="favicon"
                  label={m.admin_branding_favicon()}
                  hint={m.agency_branding_favicon_hint()}
                  accept="image/png,image/x-icon,image/vnd.microsoft.icon,.ico"
                  url={saved.faviconUrl}
                  busy={form.busy}
                  onPick={(file) =>
                    form.upload.mutate({ kind: 'favicon', file })
                  }
                  onClear={() => form.clearImage.mutate('favicon')}
                />
              </div>
            </Section>

            <Section
              id="colour"
              icon={<Palette />}
              title={m.agency_branding_colour()}
              description={m.agency_branding_colour_description()}
            >
              <div className="grid gap-3">
                <span className="text-[13px] leading-5 font-medium text-text-primary">
                  {m.admin_branding_preset()}
                </span>
                <div
                  className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-6"
                  data-testid="brand-presets"
                  role="group"
                  aria-label={m.admin_branding_preset()}
                >
                  {BRAND_PRESETS.map((preset) => {
                    const active = form.activePreset?.id === preset.id
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        data-testid={`brand-preset-${preset.id}`}
                        aria-pressed={active}
                        onClick={() => {
                          set.setAccent(preset.accent ?? '')
                          set.setFont(preset.font)
                        }}
                        className="group/swatch grid justify-items-center gap-2 rounded-[12px] py-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'relative grid size-12 place-content-center rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] ring-offset-2 ring-offset-background-surface transition-[box-shadow,transform] duration-150 group-hover/swatch:scale-[1.04] motion-reduce:group-hover/swatch:scale-100',
                            active ? 'ring-2 ring-text-primary' : 'ring-0',
                          )}
                          style={{
                            background: preset.accent ?? BUILT_IN_ACCENT,
                          }}
                        >
                          {active ? (
                            <Check
                              weight="bold"
                              className="size-5 text-white"
                            />
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            'text-callout',
                            active
                              ? 'font-medium text-text-primary'
                              : 'text-text-secondary',
                          )}
                          style={{ fontFamily: FONTS[preset.font].family }}
                        >
                          {preset.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <p className="text-caption font-normal text-text-muted">
                  {m.admin_branding_preset_hint()}
                </p>
              </div>

              <div className="border-t border-border-default pt-5">
                <FormField
                  label={m.admin_branding_accent()}
                  htmlFor="brand-accent"
                  hint={m.agency_branding_accent_hint()}
                  error={
                    form.accentInvalid
                      ? m.admin_branding_accent_error()
                      : undefined
                  }
                >
                  <div className="flex max-w-sm items-center gap-2">
                    <label
                      className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]"
                      style={{ background: form.accentHex ?? BUILT_IN_ACCENT }}
                    >
                      <span className="sr-only">
                        {m.admin_branding_accent_pick_aria()}
                      </span>
                      <input
                        type="color"
                        aria-label={m.admin_branding_accent_pick_aria()}
                        className="absolute inset-0 size-full cursor-pointer opacity-0"
                        value={form.accentHex ?? BUILT_IN_ACCENT}
                        onChange={(event) => set.setAccent(event.target.value)}
                      />
                    </label>
                    <Input
                      id="brand-accent"
                      data-testid="brand-accent"
                      className="font-mono"
                      placeholder={BUILT_IN_ACCENT}
                      maxLength={7}
                      spellCheck={false}
                      aria-invalid={form.accentInvalid || undefined}
                      value={fields.accent}
                      onChange={(event) => set.setAccent(event.target.value)}
                    />
                    {fields.accent ? (
                      <Button
                        type="button"
                        variant="quiet"
                        size="icon"
                        aria-label={m.admin_branding_accent_clear_aria()}
                        onClick={() => set.setAccent('')}
                      >
                        <X />
                      </Button>
                    ) : null}
                  </div>
                </FormField>
              </div>

              {fields.advancedEnabled ? (
                <div
                  className="flex flex-wrap items-start justify-between gap-3 rounded-[12px] bg-status-warning-bg p-4"
                  data-testid="brand-legacy-colors"
                >
                  <div className="grid max-w-[52ch] gap-0.5">
                    <p className="text-[14px] leading-5 font-medium text-text-primary">
                      {m.admin_branding_legacy_title()}
                    </p>
                    <p className="text-callout text-text-secondary">
                      {m.admin_branding_legacy_hint()}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="brand-legacy-clear"
                    onClick={form.removeLegacyColors}
                  >
                    {m.admin_branding_legacy_clear()}
                  </Button>
                </div>
              ) : null}
            </Section>

            <Section
              id="typography"
              icon={<TextAa />}
              title={m.agency_branding_typography()}
              description={m.agency_branding_typography_description()}
            >
              <FontList value={fields.font} onChange={set.setFont} />
            </Section>

            <Section
              id="sign-in"
              icon={<SignIn />}
              title={m.agency_branding_signin_title()}
              description={m.agency_branding_signin_description()}
            >
              {LOGIN_TAGLINE_LOCALES.map((locale) => {
                const id = `brand-signin-${locale}`
                const value = fields.loginTagline[locale]
                return (
                  <FormField
                    key={locale}
                    label={LOCALE_LABELS[locale]}
                    htmlFor={id}
                    trailing={`${value.length}/${LOGIN_TAGLINE_MAX_LENGTH}`}
                  >
                    <Input
                      id={id}
                      data-testid={id}
                      maxLength={LOGIN_TAGLINE_MAX_LENGTH}
                      placeholder={m.auth_tagline_default({}, { locale })}
                      value={value}
                      onChange={(event) =>
                        set.setLoginTagline(locale, event.target.value)
                      }
                    />
                  </FormField>
                )
              })}
            </Section>

            <Section
              id="email"
              icon={<span className="text-[13px] font-semibold">@</span>}
              title={m.admin_branding_email_section()}
              description={m.agency_branding_email_description()}
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
                  placeholder={fields.appName.trim() || DEFAULT_APP_NAME}
                  value={fields.emailFromName}
                  onChange={(event) => set.setEmailFromName(event.target.value)}
                />
              </FormField>
            </Section>
          </div>

          <div className="order-1 min-w-0 xl:sticky xl:top-6 xl:order-2">
            <BrandingPreview branding={preview} />
          </div>

          <FloatingBar
            open={form.dirty}
            label={m.shared_unsaved_changes()}
            fullWidthOnMobile
            data-testid="branding-save-bar"
          >
            <FloatingBarLabel className="max-md:basis-full">
              {m.shared_unsaved_changes()}
            </FloatingBarLabel>
            <FloatingBarDivider className="max-md:hidden" />
            <Button
              type="button"
              variant="quiet"
              size="sm"
              className="max-md:flex-1"
              onClick={form.discard}
              disabled={form.save.isPending}
            >
              {m.settings_discard()}
            </Button>
            <Button
              type="submit"
              size="sm"
              data-testid="save-branding"
              loading={form.save.isPending}
              className="rounded-full max-md:min-w-28 max-md:flex-1"
            >
              {m.admin_branding_save()}
            </Button>
          </FloatingBar>
        </form>
      )}
    </div>
  )
}

/** Every font, written in itself; a radio group. */
function FontList({
  value,
  onChange,
}: {
  value: FontKey
  onChange: (font: FontKey) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={m.admin_branding_font()}
      data-testid="brand-font"
      className="grid gap-2 sm:grid-cols-2"
    >
      {FONT_KEYS.map((key) => {
        const selected = key === value
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={`brand-font-${key}`}
            onClick={() => onChange(key)}
            className={cn(
              'flex items-center gap-3 rounded-[12px] border px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow] duration-150',
              'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
              selected
                ? 'border-accent bg-accent-soft/50 shadow-[0_0_0_1px_var(--color-accent)]'
                : 'border-border-default hover:border-border-strong hover:bg-surface-state-hover',
            )}
          >
            <span
              aria-hidden="true"
              className="w-9 shrink-0 text-[24px] leading-none font-medium text-text-primary"
              style={{ fontFamily: FONTS[key].family }}
            >
              Aa
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span
                className="truncate text-[15px] leading-5 font-medium text-text-primary"
                style={{ fontFamily: FONTS[key].family }}
              >
                {key === 'system'
                  ? m.admin_font_system_default()
                  : FONTS[key].label}
              </span>
              {key === DEFAULT_FONT ? (
                <span className="text-caption font-normal text-text-muted">
                  {m.agency_branding_font_default()}
                </span>
              ) : null}
            </span>
            {selected ? (
              <Check
                weight="bold"
                className="size-4 shrink-0 text-icon-accent"
              />
            ) : null}
          </button>
        )
      })}
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
  const inputRef = React.useRef<HTMLInputElement>(null)
  return (
    <div className="grid content-start gap-2">
      <span className="text-[13px] leading-5 font-medium text-text-primary">
        {label}
      </span>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'grid size-14 shrink-0 place-content-center overflow-hidden rounded-[14px]',
            url
              ? 'bg-background-subtle'
              : 'border border-dashed border-border-strong text-icon-muted',
          )}
        >
          {url ? (
            <img
              src={url}
              alt=""
              data-testid={`brand-${kind}-preview`}
              className="size-12 object-contain"
            />
          ) : (
            <ImageSquare className="size-5" />
          )}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          tabIndex={-1}
          data-testid={`brand-${kind}-input`}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onPick(file)
          }}
        />
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            data-testid={`brand-${kind}-upload`}
          >
            <UploadSimple />
            {url ? m.admin_replace() : m.admin_upload()}
          </Button>
          {url ? (
            <Button
              type="button"
              variant="quiet"
              size="sm"
              disabled={busy}
              onClick={onClear}
              data-testid={`brand-${kind}-remove`}
            >
              {m.admin_remove()}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-caption font-normal text-text-muted">{hint}</p>
    </div>
  )
}
