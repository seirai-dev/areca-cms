import * as React from 'react'
import { ArrowSquareOut, FilePdf, FileText, Trash } from '@phosphor-icons/react'

import { assetFileUrl } from '#/components/editor/utils'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { CopyButton } from '#/components/ui/copy-button'
import { SlideOver } from '#/components/ui/slide-over'
import { CheckDraw } from '#/components/ui/status-pill'
import { Textarea } from '#/components/ui/textarea'
import { Hint } from '#/components/ui/tooltip'
import { absoluteTimeLabel, formatRelativeTime } from '#/lib/relative-time'
import { m } from '#/paraglide/messages'

import { fileKind, formatBytes, isImage, isPdf } from './use-library'
import type { LibraryAsset, useAssetMutations } from './use-library'

/**
 * Library detail slide-over (brief §3.8): a big preview, the description
 * (alt text) saved on blur/Enter with a quiet "Saved", info rows, Copy link,
 * Open, and Delete (owners/admins; editors see it disabled with the reason).
 * Test id `asset-drawer`; the description field is `#asset-alt`.
 */
export function AssetDetail({
  asset,
  open,
  onOpenChange,
  canDelete,
  uploaderName,
  mutations,
}: {
  asset: LibraryAsset | null
  open: boolean
  onOpenChange: (open: boolean) => void
  canDelete: boolean
  uploaderName?: string | null
  mutations: ReturnType<typeof useAssetMutations>
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  // Keep showing the last asset while the panel animates out.
  const [shown, setShown] = React.useState(asset)
  React.useEffect(() => {
    if (asset) setShown(asset)
  }, [asset])
  const current = asset ?? shown

  return (
    <SlideOver
      open={open && current !== null}
      onOpenChange={onOpenChange}
      title={current?.originalFilename ?? m.library_file_details()}
      description={current ? fileKind(current) : undefined}
      data-testid="asset-drawer"
      footer={
        current ? (
          <div className="flex flex-wrap items-center gap-2">
            <Hint
              label={canDelete ? '' : m.library_delete_reason()}
              wrapDisabled={!canDelete}
            >
              <Button
                type="button"
                variant="quiet"
                size="sm"
                disabled={!canDelete}
                className="text-text-error hover:bg-status-error-bg hover:text-text-error"
                onClick={() => setConfirmOpen(true)}
                data-testid="asset-delete"
              >
                <Trash />
                {m.library_delete()}
              </Button>
            </Hint>
            <span className="flex-1" />
            <CopyButton
              value={() =>
                new URL(
                  assetFileUrl(current.storageKey),
                  window.location.origin,
                ).toString()
              }
              label={m.library_copy_link()}
              copiedLabel={m.library_link_copied()}
              variant="secondary"
              data-testid="asset-copy-link"
            />
            <Button type="button" variant="secondary" size="sm" asChild>
              <a
                href={assetFileUrl(current.storageKey)}
                target="_blank"
                rel="noreferrer"
                data-testid="asset-open"
              >
                <ArrowSquareOut />
                {m.library_open()}
              </a>
            </Button>
          </div>
        ) : null
      }
    >
      {current ? (
        <div className="grid gap-6 pt-1">
          <Preview asset={current} />
          <DescriptionField
            key={current.id}
            asset={current}
            mutations={mutations}
          />
          <InfoRows asset={current} uploaderName={uploaderName} />
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={m.sites_delete_file_title()}
        description={
          current
            ? m.sites_delete_file_description({
                filename: current.originalFilename,
              })
            : undefined
        }
        confirmLabel={m.sites_delete()}
        variant="destructive"
        onConfirm={async () => {
          if (!current) return
          try {
            await mutations.remove.mutateAsync(current.id)
            onOpenChange(false)
          } catch {
            // The toast carries the server's reason (e.g. still in use).
          }
        }}
      />
    </SlideOver>
  )
}

function Preview({ asset }: { asset: LibraryAsset }) {
  const url = assetFileUrl(asset.storageKey)
  return (
    <div className="grid aspect-[4/3] place-content-center overflow-hidden rounded-card border border-border-default bg-[repeating-conic-gradient(var(--color-background-subtle)_0%_25%,var(--color-background-surface)_0%_50%)] bg-size-[16px_16px]">
      {isImage(asset) ? (
        <img
          src={url}
          alt={asset.altText ?? ''}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <div className="grid justify-items-center gap-2 text-icon-muted">
          {isPdf(asset) ? (
            <FilePdf weight="duotone" className="size-16" />
          ) : (
            <FileText weight="duotone" className="size-16" />
          )}
          <span className="text-caption text-text-muted">
            {fileKind(asset)}
          </span>
        </div>
      )}
    </div>
  )
}

function DescriptionField({
  asset,
  mutations,
}: {
  asset: LibraryAsset
  mutations: ReturnType<typeof useAssetMutations>
}) {
  const [value, setValue] = React.useState(asset.altText ?? '')
  const saved = React.useRef(asset.altText ?? '')
  const [state, setState] = React.useState<'idle' | 'saving' | 'saved'>('idle')
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(timer.current), [])

  async function save() {
    const next = value.trim()
    if (next === saved.current) return
    setState('saving')
    try {
      await mutations.saveAlt.mutateAsync({ id: asset.id, altText: next })
      saved.current = next
      setState('saved')
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setState('idle'), 2400)
    } catch {
      setState('idle')
    }
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor="asset-alt"
          className="text-[13px] leading-[18px] font-medium text-text-primary"
        >
          {m.library_description_label()}
        </label>
        <span
          aria-live="polite"
          className="inline-flex items-center gap-1 text-caption text-text-muted"
          data-testid="asset-alt-status"
        >
          {state === 'saving' ? m.library_saving() : null}
          {state === 'saved' ? (
            <>
              <CheckDraw
                size={13}
                circle={false}
                className="text-icon-success"
              />
              {m.library_saved()}
            </>
          ) : null}
        </span>
      </div>
      <Textarea
        id="asset-alt"
        rows={2}
        value={value}
        placeholder={m.library_description_placeholder()}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
        className="min-h-[60px] resize-none"
      />
      <p className="text-caption font-normal text-text-muted">
        {m.library_description_hint()}
      </p>
    </div>
  )
}

function InfoRows({
  asset,
  uploaderName,
}: {
  asset: LibraryAsset
  uploaderName?: string | null
}) {
  const rows: Array<[string, React.ReactNode, string?]> = []
  if (asset.width && asset.height) {
    rows.push([m.library_info_dimensions(), `${asset.width} × ${asset.height}`])
  }
  const size = formatBytes(asset.size)
  if (size) rows.push([m.library_info_size(), size])
  rows.push([m.library_info_type(), asset.mimeType])
  if (asset.createdAt) {
    rows.push([
      m.library_info_uploaded(),
      formatRelativeTime(asset.createdAt),
      absoluteTimeLabel(asset.createdAt),
    ])
  }
  if (uploaderName) rows.push([m.library_info_by(), uploaderName])

  return (
    <dl className="overflow-hidden surface-card" data-testid="asset-info">
      {rows.map(([label, value, title]) => (
        <div
          key={label}
          className="flex items-baseline justify-between gap-4 border-b border-border-default px-4 py-2.5 last:border-b-0"
        >
          <dt className="text-callout text-text-secondary">{label}</dt>
          <dd
            className="min-w-0 truncate text-callout text-text-primary tnum"
            title={title}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
