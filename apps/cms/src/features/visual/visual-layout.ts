/**
 * Geometry for Visual mode (docs/design/visual-editor.md, Decisions 1, 7, 10).
 * Pure functions only, so the layout rules are unit tested without a DOM.
 */

/** Visual mode needs at least this viewport width. */
export const VISUAL_MIN_VIEWPORT = 1280

/** The media query that tells whether Visual mode is available. */
export const VISUAL_AVAILABLE_QUERY = `(min-width: ${VISUAL_MIN_VIEWPORT}px)`

/** Default share of the layout width for the editor column. */
export const DEFAULT_EDITOR_RATIO = 0.36

/** The editor column may not be narrower than this when dragged. */
export const EDITOR_MIN_PX = 360

/** The editor column may take at most this share of the layout. */
export const EDITOR_MAX_RATIO = 0.5

/** The default (no user choice) column is clamped to this range. */
const DEFAULT_MIN_PX = 400
const DEFAULT_MAX_PX = 720

/** Arrow keys on the divider move it this far. */
export const NUDGE_PX = 16

/** Width of the draggable divider. */
export const DIVIDER_PX = 6

export type PreviewWidth = 'desktop' | 'fit1440' | 'tablet' | 'mobile'

/** Widths in CSS pixels. `fill` means the frame takes the whole pane. */
export const PREVIEW_WIDTHS: Record<PreviewWidth, number | 'fill'> = {
  desktop: 'fill',
  fit1440: 1440,
  tablet: 768,
  mobile: 390,
}

/** The desktop size that "Fit 1440" renders at before it scales down. */
const FIT_WIDTH = 1440

function clampToLayout(px: number, layoutWidth: number): number {
  const max = layoutWidth * EDITOR_MAX_RATIO
  return Math.min(Math.max(px, EDITOR_MIN_PX), max)
}

/**
 * Width of the editor column in pixels. With no user choice (`ratio` null)
 * the 36% default is clamped to 400–720 px. A chosen ratio is only clamped
 * to the drag bounds. Both are kept within [360, 50% of the layout].
 */
export function editorColumnWidth(
  layoutWidth: number,
  ratio: number | null,
): number {
  if (ratio === null) {
    const px = Math.min(
      Math.max(layoutWidth * DEFAULT_EDITOR_RATIO, DEFAULT_MIN_PX),
      DEFAULT_MAX_PX,
    )
    return clampToLayout(px, layoutWidth)
  }
  return clampToLayout(layoutWidth * ratio, layoutWidth)
}

/** The ratio for a divider dragged to `px` from the layout's left edge. */
export function ratioFromPointer(px: number, layoutWidth: number): number {
  if (layoutWidth <= 0) return DEFAULT_EDITOR_RATIO
  return clampToLayout(px, layoutWidth) / layoutWidth
}

/** The ratio after moving the divider by `deltaPx` (keyboard). */
export function nudgeRatio(
  ratio: number | null,
  layoutWidth: number,
  deltaPx: number,
): number {
  const current = editorColumnWidth(layoutWidth, ratio)
  return ratioFromPointer(current + deltaPx, layoutWidth)
}

export type FramePresentation = {
  /** Unscaled frame width in CSS pixels. */
  width: number
  /** Unscaled frame height in CSS pixels. */
  height: number
  scale: number
}

/**
 * How the preview frame is drawn inside a pane of `paneWidth` × `paneHeight`.
 * Fit 1440 renders the frame at 1440 px and scales it down with a transform,
 * so `width * scale` and `height * scale` are the box the pane shows.
 */
export function framePresentation(
  preset: PreviewWidth,
  paneWidth: number,
  paneHeight: number,
): FramePresentation {
  if (preset === 'desktop') {
    return { width: paneWidth, height: paneHeight, scale: 1 }
  }
  if (preset === 'fit1440') {
    const scale = paneWidth > 0 ? Math.min(1, paneWidth / FIT_WIDTH) : 1
    return {
      width: FIT_WIDTH,
      height: paneHeight / scale,
      scale,
    }
  }
  const fixed = PREVIEW_WIDTHS[preset]
  const width = typeof fixed === 'number' ? fixed : paneWidth
  return {
    width: Math.min(width, paneWidth),
    height: paneHeight,
    scale: 1,
  }
}
