import { useMemo } from 'react'

import { createDataColumns, DataTable } from '#/components/data-table'
import { assetFileUrl } from '#/components/editor/utils'
import { RelativeTime } from '#/components/timeline'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import { FileText } from '@phosphor-icons/react'

import type { MediaRow } from './types'

const helper = createDataColumns<MediaRow>()

export function formatBytes(bytes: number | undefined | null) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return null
  if (bytes < 1024) return m.sites_bytes({ size: bytes })
  if (bytes < 1024 * 1024)
    return m.sites_kb({ size: (bytes / 1024).toFixed(0) })
  return m.sites_mb({ size: (bytes / (1024 * 1024)).toFixed(1) })
}

function fileExtension(filename: string) {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot + 1).toUpperCase() : ''
}

/** 40px preview of an asset: the image itself, or a document glyph. */
export function AssetThumb({
  asset,
  className,
}: {
  asset: MediaRow
  className?: string
}) {
  const isImage = asset.mimeType.startsWith('image/')
  return (
    <span
      className={cn(
        'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-control border border-border-subtle bg-background-subtle',
        className,
      )}
    >
      {isImage ? (
        <img
          src={assetFileUrl(asset.storageKey)}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <FileText className="size-4 text-icon-muted" />
      )}
    </span>
  )
}

/**
 * The asset list. Rows are buttons in spirit: clicking one opens the preview
 * panel next to the table (or a drawer on narrow screens).
 */
export function AssetTable({
  assets,
  activeId,
  onSelect,
}: {
  assets: MediaRow[]
  activeId: string | null
  onSelect: (asset: MediaRow) => void
}) {
  const showUploader = assets.some((asset) => asset.createdByName)

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor('originalFilename', {
          header: m.media_column_file(),
          cell: ({ row }) => {
            const extension = fileExtension(row.original.originalFilename)
            return (
              <div className="flex min-w-0 items-center gap-3 p-2">
                <AssetThumb asset={row.original} />
                <div className="min-w-0">
                  <p
                    className="truncate text-ds-label-md text-text-primary"
                    title={row.original.originalFilename}
                  >
                    {row.original.originalFilename}
                  </p>
                  {extension ? (
                    <p className="text-ds-mono-xs text-text-muted">
                      {extension}
                    </p>
                  ) : null}
                </div>
              </div>
            )
          },
        }),
        helper.display({
          id: 'dimensions',
          header: m.media_column_dimensions(),
          cell: ({ row }) => (
            <span className="tnum text-text-secondary">
              {row.original.width && row.original.height
                ? `${row.original.width}×${row.original.height}`
                : '—'}
            </span>
          ),
        }),
        helper.display({
          id: 'size',
          header: m.media_column_size(),
          cell: ({ row }) => (
            <span className="tnum text-text-secondary">
              {formatBytes(row.original.size) ?? '—'}
            </span>
          ),
        }),
        helper.accessor('createdAt', {
          header: m.media_column_uploaded(),
          sortFn: 'datetime',
          cell: ({ row }) => (
            <RelativeTime
              value={row.original.createdAt}
              className="text-text-secondary"
            />
          ),
        }),
        ...(showUploader
          ? [
              helper.display({
                id: 'uploader',
                header: m.media_column_uploaded_by(),
                cell: ({ row }) => (
                  <span className="text-text-secondary">
                    {row.original.createdByName ?? '—'}
                  </span>
                ),
              }),
            ]
          : []),
      ]),
    [showUploader, getLocale()],
  )

  return (
    <DataTable
      columns={columns}
      data={assets}
      caption={m.media_table_caption()}
      getRowProps={(row) => ({
        'data-testid': `media-card-${row.originalFilename}`,
        'data-state': row.id === activeId ? 'selected' : undefined,
        tabIndex: 0,
        role: 'button',
        'aria-pressed': row.id === activeId,
        className: 'cursor-pointer',
        onClick: () => onSelect(row),
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect(row)
          }
        },
      })}
    />
  )
}
