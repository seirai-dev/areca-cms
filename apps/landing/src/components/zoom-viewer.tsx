import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowsIn,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  X,
} from '@phosphor-icons/react'
import { m } from '@/paraglide/messages'

type View = { scale: number; x: number; y: number }
const MIN = 1
const MAX = 4
const REST: View = { scale: 1, x: 0, y: 0 }

/**
 * Full-screen screenshot viewer. Wheel or pinch to zoom around the pointer,
 * drag to pan, double-click to toggle zoom. Keyboard: + - 0 and arrow keys.
 */
export function ZoomViewer({
  open,
  onClose,
  name,
  alt,
}: {
  open: boolean
  onClose: () => void
  name: string
  alt: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(REST)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; view: View } | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (open && !d.open) {
      setView(REST)
      d.showModal()
    }
    if (!open && d.open) d.close()
  }, [open])

  // Zoom to `next` keeping the point (px, py) under the pointer still.
  const zoomAt = useCallback((next: number, px: number, py: number) => {
    setView((v) => {
      const scale = Math.min(MAX, Math.max(MIN, next))
      if (scale === MIN) return REST
      const rect = stage.current?.getBoundingClientRect()
      const cx = px - (rect ? rect.left + rect.width / 2 : 0)
      const cy = py - (rect ? rect.top + rect.height / 2 : 0)
      const k = scale / v.scale
      return clamp(
        { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k },
        rect,
      )
    })
  }, [])

  const centre = () => {
    const r = stage.current?.getBoundingClientRect()
    return r
      ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      : { x: 0, y: 0 }
  }

  // React's onWheel is passive, so attach a real listener to stop page zoom.
  useEffect(() => {
    const el = stage.current
    if (!el || !open) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAt(
        viewRef.current.scale *
          Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.0012),
        e.clientX,
        e.clientY,
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [open, zoomAt])

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        view: viewRef.current,
      }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      zoomAt(
        pinch.current.view.scale * (dist / pinch.current.dist),
        (a.x + b.x) / 2,
        (a.y + b.y) / 2,
      )
      return
    }
    if (viewRef.current.scale > 1) {
      const rect = stage.current?.getBoundingClientRect()
      setView((v) =>
        clamp(
          { ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y },
          rect,
        ),
      )
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  const onKey = (e: React.KeyboardEvent) => {
    const c = centre()
    const step = 80
    const rect = stage.current?.getBoundingClientRect()
    if (e.key === '+' || e.key === '=') zoomAt(view.scale * 1.4, c.x, c.y)
    else if (e.key === '-') zoomAt(view.scale / 1.4, c.x, c.y)
    else if (e.key === '0') setView(REST)
    else if (e.key === 'ArrowLeft')
      setView((v) => clamp({ ...v, x: v.x + step }, rect))
    else if (e.key === 'ArrowRight')
      setView((v) => clamp({ ...v, x: v.x - step }, rect))
    else if (e.key === 'ArrowUp')
      setView((v) => clamp({ ...v, y: v.y + step }, rect))
    else if (e.key === 'ArrowDown')
      setView((v) => clamp({ ...v, y: v.y - step }, rect))
    else return
    e.preventDefault()
  }

  const button =
    'grid size-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40'
  const img = 'block max-h-[calc(100dvh-8rem)] w-auto max-w-full select-none'

  return (
    <dialog
      ref={dialog}
      aria-label={alt}
      onClose={onClose}
      onKeyDown={onKey}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-[#0a0a0c] p-0 text-white backdrop:bg-black"
    >
      <div className="flex h-full flex-col">
        <div className="relative z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-[#0a0a0c] px-4 py-3 sm:px-6">
          <p className="hidden text-small text-white/70 sm:block">
            {m.zoom_hint()}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className={button}
              aria-label={m.zoom_out()}
              disabled={view.scale <= MIN}
              onClick={() => zoomAt(view.scale / 1.5, centre().x, centre().y)}
            >
              <MagnifyingGlassMinus size={18} />
            </button>
            <span className="w-12 text-center font-mono text-micro text-white/70">
              {Math.round(view.scale * 100)}%
            </span>
            <button
              type="button"
              className={button}
              aria-label={m.zoom_in()}
              disabled={view.scale >= MAX}
              onClick={() => zoomAt(view.scale * 1.5, centre().x, centre().y)}
            >
              <MagnifyingGlassPlus size={18} />
            </button>
            <button
              type="button"
              className={button}
              aria-label={m.zoom_reset()}
              disabled={view.scale === 1}
              onClick={() => setView(REST)}
            >
              <ArrowsIn size={18} />
            </button>
            <button
              type="button"
              className={`${button} ml-2`}
              aria-label={m.zoom_close()}
              onClick={() => dialog.current?.close()}
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div
          ref={stage}
          className={`relative flex flex-1 touch-none items-center justify-center overflow-hidden ${
            view.scale > 1
              ? 'cursor-grab active:cursor-grabbing'
              : 'cursor-zoom-in'
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(e) =>
            zoomAt(view.scale > 1 ? 1 : 2.5, e.clientX, e.clientY)
          }
        >
          <div
            className="px-4 will-change-transform sm:px-8"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transition: pointers.current.size
                ? 'none'
                : 'transform 120ms ease-out',
            }}
          >
            <img
              src={`/shots/${name}-dark.webp`}
              alt={alt}
              draggable={false}
              className={`${img} only-dark`}
            />
            <img
              src={`/shots/${name}-light.webp`}
              alt={alt}
              draggable={false}
              className={`${img} only-light`}
            />
          </div>
        </div>
      </div>
    </dialog>
  )
}

// Keep the image from being dragged completely out of view.
function clamp(v: View, rect: DOMRect | undefined): View {
  if (!rect) return v
  const maxX = (rect.width * (v.scale - 1)) / 2
  const maxY = (rect.height * (v.scale - 1)) / 2
  return {
    scale: v.scale,
    x: Math.min(maxX, Math.max(-maxX, v.x)),
    y: Math.min(maxY, Math.max(-maxY, v.y)),
  }
}
