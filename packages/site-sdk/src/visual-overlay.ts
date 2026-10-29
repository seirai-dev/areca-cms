/**
 * The bridge's on-page overlay: outlines marked elements, follows the pointer in
 * Select mode and reports markers and clicks to the CMS. Internal to the visual bridge
 * (`visual.ts` starts it); not a public subpath.
 *
 * Browser-only and dependency-free. The pure helpers at the top take anything with
 * `getAttribute` and `parentElement`, so they are tested without a DOM.
 */
import {
  MARKER_TEXT_MAX,
  MARKERS_MAX,
  markerKey,
  type Marker,
  type MarkersMessage,
  type ModeMessage,
  type SelectMessage,
} from './visual.js'

const FIELD_ATTRIBUTE = 'data-areca-field'
const ENTRY_ATTRIBUTE = 'data-areca-entry'
const GLOBAL_ATTRIBUTE = 'data-areca-global'
const HOVER_ATTRIBUTE = 'data-areca-visual-hover'
const SCAN_DEBOUNCE_MS = 100
/** The chip's height: it sits on top of the outline like a tab. */
const CHIP_OFFSET = 20
const CURSOR_OFFSET = 12
/** Space between an element and its outline, so the outline never touches text. */
const OUTLINE_GAP = 4

/** The part of an element the marker helpers read. */
export type MarkedElement = {
  getAttribute(name: string): string | null
  parentElement: MarkedElement | null
}

/** A marked element the CMS can open, with the label its chip shows. */
export type FoundTarget<E extends MarkedElement> = { element: E; marker: Marker; label: string }

type Rect = { x: number; y: number; width: number; height: number }

function isShortText(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MARKER_TEXT_MAX
}

/**
 * The marker an element carries, or null. The owner is `data-areca-entry`, else
 * `data-areca-global`, else the page's own entry. An empty or over-long value rejects
 * the whole marker.
 */
export function readMarker(element: MarkedElement): Marker | null {
  const field = element.getAttribute(FIELD_ATTRIBUTE)
  if (!isShortText(field)) return null
  const entry = element.getAttribute(ENTRY_ATTRIBUTE)
  if (entry !== null) return isShortText(entry) ? { field, owner: { entry } } : null
  const global = element.getAttribute(GLOBAL_ATTRIBUTE)
  if (global !== null) return isShortText(global) ? { field, owner: { global } } : null
  return { field, owner: null }
}

/** Distinct markers in the order given, at most `MARKERS_MAX`. */
export function collectMarkers(elements: Iterable<MarkedElement>): Marker[] {
  const seen = new Set<string>()
  const markers: Marker[] = []
  for (const element of elements) {
    if (markers.length >= MARKERS_MAX) break
    const marker = readMarker(element)
    if (!marker) continue
    const key = markerKey(marker)
    if (seen.has(key)) continue
    seen.add(key)
    markers.push(marker)
  }
  return markers
}

/**
 * The nearest element, from `start` up through its ancestors, whose marker is a target
 * (its key is in `labels`). Marked elements that are not targets are skipped.
 */
export function findTarget<E extends MarkedElement>(
  start: E | null,
  labels: ReadonlyMap<string, string>,
): FoundTarget<E> | null {
  for (let current: MarkedElement | null = start; current; current = current.parentElement) {
    const marker = readMarker(current)
    if (!marker) continue
    const label = labels.get(markerKey(marker))
    if (label !== undefined) return { element: current as E, marker, label }
  }
  return null
}

export type OverlayOptions = {
  /** Sends a message to the CMS. */
  post(message: MarkersMessage | SelectMessage): void
  document: Document
  window: Window
}

export type OverlayHandle = {
  /** Applies a mode from the CMS (select, show areas, labels, colour, targets). */
  setMode(mode: ModeMessage): void
  /** Outlines every element with this marker and scrolls the first into view if needed. `null` clears. */
  highlight(target: Marker | null): void
  /** Posts the current markers again, even if unchanged (the CMS asked again after a reload). */
  resend(): void
  /** Removes every listener, the observer, the host and the style element. */
  destroy(): void
}

const SHADOW_CSS = `
.box { position: fixed; box-sizing: border-box; border-radius: 3px; pointer-events: none; }
.hover { border: 2px solid var(--areca-color); }
.highlight { border: 2px solid var(--areca-color); box-shadow: 0 0 0 4px var(--areca-glow); }
.area { border: 1px dashed var(--areca-area); }
.chip {
  position: fixed; padding: 2px 6px; border-radius: 4px 4px 4px 0; white-space: nowrap;
  background: var(--areca-color); color: #fff;
  font: 500 12px/16px system-ui, sans-serif; pointer-events: none;
}
`

function placeBox(box: HTMLElement, rect: Rect) {
  box.style.left = `${rect.x}px`
  box.style.top = `${rect.y}px`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`
}

/** Draws one box per rect, reusing existing boxes in the layer. */
function syncBoxes(document: Document, layer: HTMLElement, rects: Rect[], className: string) {
  while (layer.childElementCount > rects.length) layer.lastElementChild?.remove()
  rects.forEach((rect, index) => {
    let box = layer.children[index] as HTMLElement | undefined
    if (!box) {
      box = document.createElement('div')
      box.className = className
      layer.append(box)
    }
    placeBox(box, rect)
  })
}

/** Starts the overlay on `document`. Nothing is outlined until `setMode` arrives. */
export function startOverlay({ post, document, window }: OverlayOptions): OverlayHandle {
  const root = document.documentElement

  const host = document.createElement('div')
  host.setAttribute('data-areca-visual', 'overlay')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = SHADOW_CSS
  const areaLayer = document.createElement('div')
  const highlightLayer = document.createElement('div')
  const hoverBox = document.createElement('div')
  hoverBox.className = 'box hover'
  hoverBox.style.display = 'none'
  const chip = document.createElement('div')
  chip.className = 'chip'
  chip.style.display = 'none'
  shadow.append(style, areaLayer, highlightLayer, hoverBox, chip)

  const pageStyle = document.createElement('style')
  pageStyle.setAttribute('data-areca-visual', 'style')
  pageStyle.textContent = `[${HOVER_ATTRIBUTE}] { cursor: pointer !important; }`

  let mode: ModeMessage | null = null
  let labels = new Map<string, string>()
  let marked: Element[] = []
  let highlightKey: string | null = null
  let highlighted: Element[] = []
  let areas: Element[] = []
  let hover: { element: Element; label: string } | null = null
  let pointer: { x: number; y: number } | null = null
  let altDown = false
  let lastMarkersKey: string | null = null
  let scanTimer: number | undefined
  let frame: number | undefined
  let destroyed = false

  function rectOf(element: Element): Rect | null {
    const box = element.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) return null
    return {
      x: box.left - OUTLINE_GAP,
      y: box.top - OUTLINE_GAP,
      width: box.width + OUTLINE_GAP * 2,
      height: box.height + OUTLINE_GAP * 2,
    }
  }

  function rectsOf(elements: Element[]): Rect[] {
    return elements.map(rectOf).filter((rect): rect is Rect => rect !== null)
  }

  function render() {
    frame = undefined
    const hoverRect = hover ? rectOf(hover.element) : null
    if (hover && hoverRect) {
      placeBox(hoverBox, hoverRect)
      hoverBox.style.display = 'block'
      chip.textContent = hover.label
      chip.style.display = 'block'
      if (mode?.cursorHint && pointer) {
        chip.style.left = `${pointer.x + CURSOR_OFFSET}px`
        chip.style.top = `${pointer.y + CURSOR_OFFSET}px`
      } else {
        chip.style.left = `${hoverRect.x}px`
        chip.style.top = `${hoverRect.y >= CHIP_OFFSET ? hoverRect.y - CHIP_OFFSET : hoverRect.y + 4}px`
      }
    } else {
      hoverBox.style.display = 'none'
      chip.style.display = 'none'
    }
    syncBoxes(document, highlightLayer, rectsOf(highlighted), 'box highlight')
    syncBoxes(document, areaLayer, mode?.showAreas ? rectsOf(areas) : [], 'box area')
  }

  function scheduleRender() {
    if (frame === undefined && !destroyed) frame = window.requestAnimationFrame(render)
  }

  /** Re-reads the marked elements and the targets they belong to. */
  function refreshMarked() {
    marked = Array.from(document.querySelectorAll(`[${FIELD_ATTRIBUTE}]`))
    const keyed = marked.flatMap((element) => {
      const marker = readMarker(element)
      return marker ? [{ element, key: markerKey(marker) }] : []
    })
    highlighted =
      highlightKey === null ? [] : keyed.filter((item) => item.key === highlightKey).map((item) => item.element)
    areas = mode?.showAreas ? keyed.filter((item) => labels.has(item.key)).map((item) => item.element) : []
    if (hover && !hover.element.isConnected) hover = null
  }

  function scan() {
    scanTimer = undefined
    refreshMarked()
    const markers = collectMarkers(marked)
    const key = JSON.stringify(markers.map(markerKey))
    if (key !== lastMarkersKey) {
      lastMarkersKey = key
      post({ type: 'areca:v1:markers', markers })
    }
    scheduleRender()
  }

  function scheduleScan() {
    if (destroyed) return
    window.clearTimeout(scanTimer)
    scanTimer = window.setTimeout(scan, SCAN_DEBOUNCE_MS)
  }

  function setHover(next: { element: Element; label: string } | null) {
    if (hover?.element === next?.element && hover?.label === next?.label) return
    hover?.element.removeAttribute(HOVER_ATTRIBUTE)
    hover = next
    next?.element.setAttribute(HOVER_ATTRIBUTE, '')
    scheduleRender()
  }

  /** Alt (Option on Mac) held means Browse for that event. Events without altKey use the last known state. */
  function altHeld(event: Event): boolean {
    if ('altKey' in event && typeof (event as MouseEvent).altKey === 'boolean') {
      altDown = (event as MouseEvent).altKey
    }
    return altDown
  }

  function isSelecting(event: Event): boolean {
    return mode?.select === true && !altHeld(event)
  }

  function targetOf(event: Event): Element | null {
    return event.target instanceof Element ? event.target : null
  }

  function onPointer(event: Event) {
    const pointerEvent = event as MouseEvent
    pointer = { x: pointerEvent.clientX, y: pointerEvent.clientY }
    if (!isSelecting(event)) {
      setHover(null)
      return
    }
    setHover(findTarget(targetOf(event), labels))
    if (mode?.cursorHint) scheduleRender()
  }

  function onClick(event: Event) {
    if (!isSelecting(event)) return
    event.preventDefault()
    event.stopPropagation()
    const found = findTarget(targetOf(event), labels)
    if (!found) return
    const box = found.element.getBoundingClientRect()
    post({
      type: 'areca:v1:select',
      field: found.marker.field,
      owner: found.marker.owner,
      rect: { x: box.left, y: box.top, width: box.width, height: box.height },
    })
  }

  /** The pointer left the page (into the CMS): drop the hover outline. */
  function onLeave(event: Event) {
    if ((event as MouseEvent).relatedTarget === null) {
      pointer = null
      setHover(null)
    }
  }

  function onSubmit(event: Event) {
    if (isSelecting(event)) event.preventDefault()
  }

  function onKey(event: Event) {
    altHeld(event)
  }

  function setMode(next: ModeMessage) {
    mode = next
    labels = new Map(next.targets.map((target) => [markerKey(target), target.label]))
    host.style.setProperty('--areca-color', next.color)
    host.style.setProperty('--areca-glow', `${next.color}33`)
    host.style.setProperty('--areca-area', `${next.color}99`)
    setHover(next.select && hover ? findTarget(hover.element, labels) : null)
    refreshMarked()
    scheduleRender()
  }

  function highlight(target: Marker | null) {
    highlightKey = target ? markerKey(target) : null
    refreshMarked()
    const first = highlighted[0]
    if (first) {
      const box = first.getBoundingClientRect()
      const inView =
        box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth
      if (!inView) first.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    scheduleRender()
  }

  const documentListeners: [string, (event: Event) => void][] = [
    ['pointermove', onPointer],
    ['mouseover', onPointer],
    ['mouseout', onLeave],
    ['click', onClick],
    ['submit', onSubmit],
    ['keydown', onKey],
    ['keyup', onKey],
    // An image finishing loading moves everything after it.
    ['load', scheduleRender],
  ]
  const windowListeners: [string, () => void][] = [
    ['scroll', scheduleRender],
    ['resize', scheduleRender],
  ]

  // Mount: the page style and the host go in before observing, so our own writes are not seen.
  ;(document.head ?? root).append(pageStyle)
  root.append(host)
  for (const [type, listener] of documentListeners) document.addEventListener(type, listener, { capture: true })
  for (const [type, listener] of windowListeners) {
    window.addEventListener(type, listener, { capture: true, passive: true })
  }
  const observer = new MutationObserver(scheduleScan)
  observer.observe(root, {
    childList: true,
    subtree: true,
    // Live updates often change only text, which moves the boxes below it.
    characterData: true,
    attributes: true,
    attributeFilter: [FIELD_ATTRIBUTE, ENTRY_ATTRIBUTE, GLOBAL_ATTRIBUTE],
  })
  scan()

  return {
    setMode,
    highlight,
    resend() {
      if (destroyed) return
      lastMarkersKey = null
      window.clearTimeout(scanTimer)
      scan()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      observer.disconnect()
      window.clearTimeout(scanTimer)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      for (const [type, listener] of documentListeners) document.removeEventListener(type, listener, { capture: true })
      for (const [type, listener] of windowListeners) {
        window.removeEventListener(type, listener, { capture: true })
      }
      hover?.element.removeAttribute(HOVER_ATTRIBUTE)
      hover = null
      host.remove()
      pageStyle.remove()
    },
  }
}
