import * as React from 'react'

import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import {
  DEFAULT_EDITOR_RATIO,
  DIVIDER_PX,
  EDITOR_MIN_PX,
  EDITOR_MAX_RATIO,
  NUDGE_PX,
  editorColumnWidth,
  nudgeRatio,
  ratioFromPointer,
} from './visual-layout'
import { useVisualPreferences } from './visual-preferences'

/**
 * Visual mode's two columns: the editor fields on the left (its own scroll),
 * a draggable divider, and the preview on the right. The ratio is remembered
 * per browser; it is not pixels, so it scales across monitors.
 */
export function VisualEditorLayout({
  column,
  preview,
}: {
  column: React.ReactNode
  preview: React.ReactNode
}) {
  const prefs = useVisualPreferences()
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [layoutWidth, setLayoutWidth] = React.useState(0)
  // The ratio while a drag is in progress; committed on release.
  const [drag, setDrag] = React.useState<number | null>(null)
  const dragging = drag !== null

  React.useLayoutEffect(() => {
    const node = rootRef.current
    if (!node) return
    const update = () => setLayoutWidth(node.getBoundingClientRect().width)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const shown = drag ?? prefs.ratio
  const editorPx =
    layoutWidth > 0 ? editorColumnWidth(layoutWidth, shown) : null
  const nowPercent =
    layoutWidth > 0
      ? Math.round(((editorPx ?? 0) / layoutWidth) * 100)
      : Math.round(DEFAULT_EDITOR_RATIO * 100)
  const minPercent =
    layoutWidth > 0 ? Math.ceil((EDITOR_MIN_PX / layoutWidth) * 100) : 0
  const maxPercent = Math.round(EDITOR_MAX_RATIO * 100)

  function ratioAt(clientX: number) {
    const left = rootRef.current?.getBoundingClientRect().left ?? 0
    return ratioFromPointer(clientX - left, layoutWidth)
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag(ratioAt(event.clientX))
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (drag === null) return
    setDrag(ratioAt(event.clientX))
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (drag === null) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    prefs.setRatio(drag)
    setDrag(null)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const delta =
      event.key === 'ArrowRight'
        ? NUDGE_PX
        : event.key === 'ArrowLeft'
          ? -NUDGE_PX
          : 0
    if (delta === 0) return
    event.preventDefault()
    prefs.setRatio(nudgeRatio(prefs.ratio, layoutWidth, delta))
  }

  return (
    <div
      ref={rootRef}
      data-testid="visual-editor"
      role="region"
      aria-label={m.visual_layout_label()}
      className="grid h-[calc(100dvh-var(--editor-bar-h,56px))] min-h-0 w-full"
      style={{
        gridTemplateColumns: editorPx
          ? `${editorPx}px ${DIVIDER_PX}px minmax(0,1fr)`
          : `minmax(0,36fr) ${DIVIDER_PX}px minmax(0,64fr)`,
      }}
    >
      <div
        data-testid="visual-editor-column"
        data-visual-column=""
        className="min-h-0 overflow-y-auto bg-background-default scroll-quiet"
      >
        <div className="mx-auto grid w-full max-w-[720px] gap-6 px-6 pt-6 pb-24">
          {column}
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={m.visual_divider_label()}
        aria-valuenow={nowPercent}
        aria-valuemin={minPercent}
        aria-valuemax={maxPercent}
        tabIndex={0}
        title={m.visual_divider_reset()}
        data-testid="visual-divider"
        data-dragging={dragging ? 'true' : 'false'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => prefs.setRatio(null)}
        onKeyDown={onKeyDown}
        className="group relative cursor-col-resize touch-none select-none outline-none"
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border-default transition-colors duration-150 ease-(--ease-standard) motion-reduce:transition-none',
            'group-hover:w-[2px] group-hover:bg-accent',
            'group-focus-visible:w-[2px] group-focus-visible:bg-accent',
            'group-data-[dragging=true]:w-[2px] group-data-[dragging=true]:bg-accent',
          )}
        />
      </div>

      <div
        className={cn(
          'relative min-h-0 min-w-0',
          // Keeps the pointer over the divider, not the cross-origin iframe.
          dragging && 'pointer-events-none',
        )}
      >
        {preview}
      </div>
    </div>
  )
}
