import * as React from 'react'
import { ArrowsClockwise, ImageSquare, Plus, Trash, Warning } from '@phosphor-icons/react'

import { assetFileUrl } from '#/components/editor/utils'
import { Button } from '#/components/ui/button'
import { useAsset } from '#/features/collection/entry-cover'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { MediaPickerDialog } from '../media-picker'
import type { MediaAsset } from '../media-picker'

/**
 * Image field (brief §3.5): a 16:10 thumbnail well. Empty, the well itself
 * is the "Choose" button; filled, it shows the file with Replace and Remove,
 * and a warning when the image has no description (alt text).
 */
export function ImageWell({
  id,
  organizationId,
  value,
  onChange,
  invalid,
}: {
  id: string
  organizationId: string
  value: unknown
  onChange: (value: string) => void
  invalid?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const assetId = typeof value === 'string' ? value : ''
  const assetQuery = useAsset(assetId || undefined)
  const asset = (assetQuery.data ?? null) as MediaAsset | null
  const image = asset?.mimeType.startsWith('image/') ? asset : null

  return (
    <div className="grid gap-2">
      {assetId ? (
        <div className="grid gap-2">
          <button
            type="button"
            id={id}
            onClick={() => setOpen(true)}
            aria-label={m.editor_replace_image()}
            className="group relative aspect-[16/10] w-full overflow-hidden rounded-[10px] border border-border-default bg-background-subtle outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            {image ? (
              <img
                src={assetFileUrl(image.storageKey)}
                alt={image.altText ?? image.originalFilename}
                className="size-full object-cover transition-transform duration-300 ease-(--ease-standard) group-hover:scale-[1.02] motion-reduce:transition-none"
                data-testid="image-field-thumb"
              />
            ) : (
              <span className="grid size-full place-content-center text-icon-muted">
                <ImageSquare className="size-7" />
              </span>
            )}
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid min-w-0 flex-1">
              {asset ? (
                <>
                  <p
                    className="truncate text-callout font-medium text-text-primary"
                    title={asset.originalFilename}
                  >
                    {asset.originalFilename}
                  </p>
                  {asset.width && asset.height ? (
                    <p className="text-caption font-normal text-text-muted tnum">
                      {asset.width} × {asset.height}
                    </p>
                  ) : null}
                </>
              ) : assetQuery.isLoading ? (
                <p className="text-callout text-text-muted">{m.editor_loading()}</p>
              ) : (
                <p className="text-callout text-text-error">{m.editor_image_deleted()}</p>
              )}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => setOpen(true)}
            >
              <ArrowsClockwise />
              {m.editor_replace()}
            </Button>
            <Button
              type="button"
              variant="quiet"
              size="icon-xs"
              aria-label={m.editor_remove_image()}
              title={m.editor_remove_image()}
              onClick={() => onChange('')}
              data-testid="image-field-remove"
            >
              <Trash />
            </Button>
          </div>
          {asset && !asset.altText?.trim() ? (
            <p
              className="flex items-start gap-1.5 rounded-[8px] bg-status-warning-bg px-2.5 py-1.5 text-caption font-normal text-text-warning"
              data-testid="image-field-alt-warning"
            >
              <Warning weight="fill" className="mt-px size-3.5 shrink-0" />
              {m.editor_image_no_description()}
            </p>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          id={id}
          onClick={() => setOpen(true)}
          className={cn(
            'group grid aspect-[16/10] w-full place-content-center justify-items-center gap-2 rounded-[10px] border border-dashed bg-background-subtle/60 text-center outline-none',
            'transition-colors duration-150 hover:border-accent hover:bg-accent-soft/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
            invalid ? 'border-border-error' : 'border-border-strong',
          )}
        >
          <span className="grid size-10 place-content-center rounded-full bg-background-surface text-icon-accent shadow-card transition-transform duration-150 group-hover:scale-105">
            <Plus weight="bold" className="size-4" />
          </span>
          <span className="text-callout font-medium text-text-primary">
            {m.editor_choose_image()}
          </span>
          <span className="text-caption font-normal text-text-muted">
            {m.editor_choose_image_hint()}
          </span>
        </button>
      )}
      <MediaPickerDialog
        open={open}
        onOpenChange={setOpen}
        organizationId={organizationId}
        onSelect={(next) => onChange(next.id)}
      />
    </div>
  )
}
