import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { RotateCcw, Upload, X } from 'lucide-react'
import { toast } from 'sonner'

import { errorMessage } from '#/components/admin/helpers'
import { TableSkeleton } from '#/components/admin/table-skeleton'
import { BrandLogo, BrandMark } from '#/components/brand-mark'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { FormField } from '#/components/form-field'
import { PageHeader } from '#/components/page-header'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  DEFAULT_APP_NAME,
  DEFAULT_FONT,
  FONTS,
  FONT_KEYS,
  accentStyle,
  fontStylesheetUrl,
  normalizeHex,
} from '#/lib/branding'
import type { BrandingView, FontKey } from '#/lib/branding'
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

async function uploadBrandingImage(kind: ImageKind, file: File) {
  const body = new FormData()
  body.append('file', file)
  body.append('kind', kind)
  const response = await fetch('/api/admin/branding/upload', {
    method: 'POST',
    body,
  })
  if (!response.ok) {
    throw new Error((await response.text()) || 'Upload failed')
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

  // Seed the form from the saved values, and again after each save.
  useEffect(() => {
    if (!saved) return
    setAppName(saved.appName === DEFAULT_APP_NAME ? '' : saved.appName)
    setEmailFromName(saved.emailFromName ?? '')
    setAccent(saved.accentColor ?? '')
    setFont(saved.font)
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
          font,
        },
      }),
    onSuccess: async (next) => {
      toast.success('Branding saved')
      await applySaved(next)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const uploadMutation = useMutation({
    mutationFn: ({ kind, file }: { kind: ImageKind; file: File }) =>
      uploadBrandingImage(kind, file),
    onSuccess: async (next, { kind }) => {
      toast.success(kind === 'logo' ? 'Logo updated' : 'Favicon updated')
      await applySaved(next)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const clearMutation = useMutation({
    mutationFn: (kind: ImageKind) => clearImage({ data: { kind } }),
    onSuccess: async (next, kind) => {
      toast.success(kind === 'logo' ? 'Logo removed' : 'Favicon removed')
      await applySaved(next)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const resetMutation = useMutation({
    mutationFn: () => resetBranding(),
    onSuccess: async (next) => {
      toast.success('Branding reset to defaults')
      await applySaved(next)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (brandingQuery.isError) {
    return (
      <div className="grid gap-6">
        <QueryError
          title="Could not load branding"
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

  const dirty =
    (appName.trim() || DEFAULT_APP_NAME) !== saved.appName ||
    (emailFromName.trim() || null) !== saved.emailFromName ||
    (accentHex ?? null) !== saved.accentColor ||
    font !== saved.font

  const preview: BrandingView = {
    ...saved,
    appName: appName.trim() || DEFAULT_APP_NAME,
    accentColor: accentHex,
    font,
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (accentInvalid) {
      toast.error('Accent colour must be a hex value like #1e90ff')
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
        title="Branding"
        description="Whitelabel this CMS for your agency. Changes apply to everyone, including the sign-in and invitation pages."
        actions={
          <ConfirmDialog
            title="Reset branding?"
            description="The name, logo, favicon, accent colour, and font go back to the built-in defaults. Uploaded images are deleted."
            confirmLabel="Reset to defaults"
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
              Reset to defaults
            </Button>
          </ConfirmDialog>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <form className="grid gap-6" onSubmit={onSubmit}>
          <section className="grid gap-4">
            <h2 className="text-lg font-medium">Identity</h2>
            <FormField
              label="Name"
              htmlFor="brand-name"
              hint={`Shown in the sidebar, browser tab, and emails. Leave blank for “${DEFAULT_APP_NAME}”.`}
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
              label="Logo"
              hint="PNG, JPEG, WebP, GIF, or SVG up to 2 MB. Square images look best."
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              url={saved.logoUrl}
              busy={busy}
              onPick={(file) => uploadMutation.mutate({ kind: 'logo', file })}
              onClear={() => clearMutation.mutate('logo')}
            />

            <ImageField
              kind="favicon"
              label="Favicon"
              hint="PNG, SVG, or ICO up to 2 MB."
              accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,.ico"
              url={saved.faviconUrl}
              busy={busy}
              onPick={(file) =>
                uploadMutation.mutate({ kind: 'favicon', file })
              }
              onClear={() => clearMutation.mutate('favicon')}
            />
          </section>

          <section className="grid gap-4">
            <h2 className="text-lg font-medium">Appearance</h2>
            <FormField
              label="Accent colour"
              htmlFor="brand-accent"
              hint="Tints buttons, links, and the active sidebar marker in light and dark mode. Leave blank for the default palette."
              error={accentInvalid ? 'Use a hex value like #1e90ff' : undefined}
            >
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick accent colour"
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
                    aria-label="Clear accent colour"
                    onClick={() => setAccent('')}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            </FormField>

            <FormField label="Font" htmlFor="brand-font">
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
                      {FONTS[key].label}
                      {key === DEFAULT_FONT ? ' (default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </section>

          <section className="grid gap-4">
            <h2 className="text-lg font-medium">Email</h2>
            <FormField
              label="Sender name"
              htmlFor="brand-email-from"
              hint="Display name on invitation emails. Defaults to the app name; the address comes from SMTP_FROM."
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
              disabled={busy || !dirty || accentInvalid}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save branding'}
            </Button>
          </div>
        </form>

        <BrandingPreview branding={preview} />
      </div>
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
            <span className="text-xs text-muted-foreground">None</span>
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
          {url ? 'Replace' : 'Upload'}
        </Button>
        {url ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onClear}
          >
            Remove
          </Button>
        ) : null}
      </div>
    </FormField>
  )
}

function BrandingPreview({ branding }: { branding: BrandingView }) {
  const fontUrl = fontStylesheetUrl(branding.font)

  return (
    <aside className="grid content-start gap-3" aria-label="Preview">
      {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
      <h2 className="text-lg font-medium">Preview</h2>
      <div
        data-testid="branding-preview"
        className="grid gap-5 rounded-md border bg-background p-5"
        style={{
          ...accentStyle(branding.accentColor),
          fontFamily: FONTS[branding.font].family,
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <BrandMark branding={branding} />
          <span className="text-xs text-muted-foreground">
            {FONTS[branding.font].label}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          The quick brown fox jumps over the lazy dog. Links look{' '}
          <a
            href="#preview"
            className="text-link"
            onClick={(e) => e.preventDefault()}
          >
            like this
          </a>
          .
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button">Primary action</Button>
          <Button type="button" variant="secondary">
            Secondary
          </Button>
          <Button type="button" variant="outline">
            Outline
          </Button>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-sidebar px-3 py-2 text-sm text-sidebar-foreground shadow-[inset_3px_0_0_var(--sidebar-primary)]">
          <BrandLogo branding={branding} className="size-6" />
          Active sidebar item
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Name, colour, and font update live. Logo and favicon apply as soon as
        they are uploaded.
      </p>
    </aside>
  )
}
