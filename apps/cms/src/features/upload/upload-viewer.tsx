import * as React from 'react'
import { CaretLeft, CaretRight, Trash } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '#/components/ui/dialog'
import { m } from '#/paraglide/messages'

import { formatBytes } from './upload-files'
import type { TrayItem } from './upload-screen'

const SWIPE_PX = 50

/**
 * Full-size view of the tray's images before they are sent: arrow keys or a
 * swipe move between them, Esc closes, and a staged image can be removed here.
 */
export function UploadViewer({
  items,
  openId,
  onOpenChange,
  onRemove,
}: {
  items: TrayItem[]
  openId: string | null
  onOpenChange: (id: string | null) => void
  onRemove: (id: string) => void
}) {
  const index = items.findIndex((item) => item.id === openId)
  const item = index >= 0 ? items[index] : undefined
  const swipeStart = React.useRef<number | null>(null)

  const go = React.useCallback(
    (step: number) => {
      if (!items.length || index < 0) return
      const next = items.at((index + step) % items.length)
      if (next) onOpenChange(next.id)
    },
    [items, index, onOpenChange],
  )

  const removable = item?.status === 'staged' || item?.status === 'failed'

  return (
    <Dialog
      open={Boolean(item)}
      onOpenChange={(open) => {
        if (!open) onOpenChange(null)
      }}
    >
      <DialogContent
        size="xl"
        data-testid="upload-viewer"
        className="gap-4 p-4 sm:p-5"
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            go(1)
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault()
            go(-1)
          }
        }}
      >
        {item?.previewUrl ? (
          <>
            <div className="grid gap-0.5 pr-10">
              <DialogTitle className="truncate text-headline">
                {item.file.name}
              </DialogTitle>
              <DialogDescription className="text-caption text-text-muted">
                {formatBytes(item.file.size)}
                {items.length > 1
                  ? ` · ${m.upload_viewer_counter({
                      index: String(index + 1),
                      total: String(items.length),
                    })}`
                  : ''}
              </DialogDescription>
            </div>

            <div
              className="relative flex touch-pan-y items-center justify-center overflow-hidden rounded-[12px] bg-background-subtle"
              onPointerDown={(event) => {
                swipeStart.current = event.clientX
              }}
              onPointerUp={(event) => {
                if (swipeStart.current === null) return
                const delta = event.clientX - swipeStart.current
                swipeStart.current = null
                if (Math.abs(delta) >= SWIPE_PX) go(delta < 0 ? 1 : -1)
              }}
            >
              <img
                src={item.previewUrl}
                alt={item.file.name}
                className="max-h-[70dvh] w-auto max-w-full object-contain select-none"
                draggable={false}
                data-testid="upload-viewer-image"
              />
              {items.length > 1 ? (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full"
                    onClick={() => go(-1)}
                    aria-label={m.upload_viewer_prev()}
                  >
                    <CaretLeft weight="bold" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full"
                    onClick={() => go(1)}
                    aria-label={m.upload_viewer_next()}
                    data-testid="upload-viewer-next"
                  >
                    <CaretRight weight="bold" />
                  </Button>
                </>
              ) : null}
            </div>

            {removable ? (
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="upload-viewer-remove"
                  onClick={() => {
                    // Show the next image, or close when this was the last.
                    const next =
                      items.length > 1
                        ? items[(index + 1) % items.length]
                        : undefined
                    onRemove(item.id)
                    onOpenChange(next && next.id !== item.id ? next.id : null)
                  }}
                >
                  <Trash />
                  {m.upload_remove_short()}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
