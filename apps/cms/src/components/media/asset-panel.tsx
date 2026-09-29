import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

import { assetFileUrl, errorMessage } from '#/components/editor/utils'
import { FormField } from '#/components/ui/form-field'
import { RelativeTime } from '#/components/ui/timeline'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet'
import { m } from '#/paraglide/messages'
import { updateAssetFn } from '#/server/fn/assets'
import {
  ArrowSquareOut,
  Check,
  Copy,
  FileText,
  Trash,
  X,
} from '@phosphor-icons/react'

import { formatBytes } from './asset-table'
import type { MediaRow } from './types'

function MetaRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border-subtle py-2 last:border-b-0">
      <dt className="text-ds-body-xs text-text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-ds-body-sm text-text-primary">
        {children}
      </dd>
    </div>
  )
}

/**
 * Everything known about one asset: preview, alt text (saved on blur),
 * metadata, URL and delete. Rendered as a column on `lg` and inside a drawer
 * below it, so the markup is shared and only the frame changes.
 */
export function AssetPanel({
  asset,
  canDelete,
  onDelete,
  onSaved,
  className,
}: {
  asset: MediaRow
  canDelete: boolean
  onDelete: () => void
  onSaved: () => Promise<void>
  className?: string
}) {
  const [alt, setAlt] = useState(asset.altText ?? '')
  const [copied, setCopied] = useState(false)
  const savedAlt = useRef(asset.altText ?? '')

  useEffect(() => {
    setAlt(asset.altText ?? '')
    savedAlt.current = asset.altText ?? ''
    setCopied(false)
  }, [asset.id, asset.altText])

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; altText: string }) =>
      updateAssetFn({ data: input }),
    onSuccess: async (_data, input) => {
      savedAlt.current = input.altText
      toast.success(m.sites_alt_text_saved())
      await onSaved()
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.sites_alt_text_save_failed())),
  })

  const isImage = asset.mimeType.startsWith('image/')
  const url = assetFileUrl(asset.storageKey)

  function saveAlt() {
    const next = alt.trim()
    if (next === savedAlt.current) return
    updateMutation.mutate({ id: asset.id, altText: next })
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(
        new URL(url, window.location.origin).toString(),
      )
      setCopied(true)
    } catch {
      toast.error(m.sites_copy_logs_failed())
    }
  }

  return (
    <div className={className}>
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-surface border border-border-subtle bg-background-subtle">
        {isImage ? (
          <img
            src={url}
            alt={asset.altText ?? ''}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <FileText className="size-10 text-icon-muted" />
        )}
      </div>

      <FormField
        label={m.sites_alt_text()}
        htmlFor="asset-alt"
        hint={m.sites_alt_text_hint()}
      >
        <Input
          id="asset-alt"
          placeholder={m.sites_alt_text()}
          value={alt}
          onChange={(event) => setAlt(event.target.value)}
          onBlur={saveAlt}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
      </FormField>

      <dl className="grid">
        <MetaRow label={m.media_column_dimensions()}>
          {asset.width && asset.height ? `${asset.width}×${asset.height}` : '—'}
        </MetaRow>
        <MetaRow label={m.media_column_size()}>
          {formatBytes(asset.size) ?? '—'}
        </MetaRow>
        <MetaRow label={m.media_type()}>{asset.mimeType}</MetaRow>
        <MetaRow label={m.media_column_uploaded()}>
          <RelativeTime value={asset.createdAt} />
        </MetaRow>
        {asset.createdByName ? (
          <MetaRow label={m.media_column_uploaded_by()}>
            {asset.createdByName}
          </MetaRow>
        ) : null}
      </dl>

      <div className="grid gap-2">
        <p className="text-ds-body-xs text-text-muted">{m.media_url()}</p>
        <p className="truncate rounded-control bg-background-subtle px-3 py-2 text-ds-mono-xs text-text-secondary">
          {url}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={copyUrl}>
            {copied ? <Check /> : <Copy />}
            {copied ? m.sites_url_copied() : m.sites_copy_url()}
          </Button>
          <Button type="button" size="sm" variant="ghost" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ArrowSquareOut />
              {m.media_open()}
            </a>
          </Button>
        </div>
      </div>

      {canDelete ? (
        <div className="border-t border-border-subtle pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-text-error hover:bg-status-error-bg hover:text-text-error"
            onClick={onDelete}
          >
            <Trash />
            {m.sites_delete()}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The preview panel in its two frames: a sticky right column on `lg`, a
 * right-hand drawer below it. Both carry the `asset-drawer` test id.
 */
export function AssetPreview({
  asset,
  compact,
  canDelete,
  onClose,
  onDelete,
  onSaved,
}: {
  asset: MediaRow | null
  /** True below `lg`, where the panel becomes a drawer. */
  compact: boolean
  canDelete: boolean
  onClose: () => void
  onDelete: () => void
  onSaved: () => Promise<void>
}) {
  if (compact) {
    return (
      <Sheet
        open={asset !== null}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <SheetContent
          size="md"
          className="gap-0 p-0"
          data-testid="asset-drawer"
        >
          {asset ? (
            <>
              <SheetHeader>
                <SheetTitle className="truncate pr-8">
                  {asset.originalFilename}
                </SheetTitle>
              </SheetHeader>
              <SheetBody>
                <AssetPanel
                  asset={asset}
                  canDelete={canDelete}
                  onDelete={onDelete}
                  onSaved={onSaved}
                  className="grid gap-5"
                />
              </SheetBody>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    )
  }

  if (!asset) return null

  return (
    <aside
      data-testid="asset-drawer"
      aria-label={m.media_details()}
      className="sticky top-[7.5rem] grid gap-5 self-start rounded-surface border border-border-default bg-background-surface p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className="min-w-0 truncate text-ds-heading-5 text-text-primary"
          title={asset.originalFilename}
        >
          {asset.originalFilename}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={m.ui_close()}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <AssetPanel
        asset={asset}
        canDelete={canDelete}
        onDelete={onDelete}
        onSaved={onSaved}
        className="grid gap-5"
      />
    </aside>
  )
}
