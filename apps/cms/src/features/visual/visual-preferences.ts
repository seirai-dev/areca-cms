import * as React from 'react'

import { useStoredState } from '#/hooks/use-stored-state'
import type { StoredCodec } from '#/hooks/use-stored-state'

import { PREVIEW_WIDTHS } from './visual-layout'
import type { PreviewWidth } from './visual-layout'

/** The editor column's share of the layout, per browser. Null = default. */
export const RATIO_STORAGE_KEY = 'areca:visual:ratio'
/** The preview width preset, per browser. */
export const WIDTH_STORAGE_KEY = 'areca:visual:width'
/** The last editor mode, per browser. Mirrored in `?view=visual`. */
export const MODE_STORAGE_KEY = 'areca:editor:mode'
/** "Show editable areas" in the preview toolbar, per browser. Off by default. */
export const AREAS_STORAGE_KEY = 'areca:visual:areas'
/** Set once the user has entered Visual mode; hides the "New" dot. */
export const SEEN_STORAGE_KEY = 'areca:visual:seen'

export type EditorMode = 'write' | 'visual'

/** A stored ratio is a fraction strictly between 0 and 1, else no choice. */
export function parseStoredRatio(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 && value < 1 ? value : null
}

const WIDTH_KEYS = Object.keys(PREVIEW_WIDTHS) as PreviewWidth[]

export function parseStoredWidth(raw: string | null): PreviewWidth {
  const match = WIDTH_KEYS.find((key) => key === raw)
  return match ?? 'desktop'
}

export function parseStoredMode(raw: string | null): EditorMode | null {
  return raw === 'write' || raw === 'visual' ? raw : null
}

const RATIO: StoredCodec<number | null> = {
  parse: parseStoredRatio,
  serialize: (ratio) => (ratio === null ? null : String(ratio)),
}
const WIDTH: StoredCodec<PreviewWidth> = {
  parse: parseStoredWidth,
  serialize: (width) => width,
}
const MODE: StoredCodec<EditorMode | null> = {
  parse: parseStoredMode,
  serialize: (mode) => mode,
}
const AREAS: StoredCodec<boolean> = {
  parse: (raw) => raw === 'on',
  serialize: (on) => (on ? 'on' : null),
}
const SEEN: StoredCodec<boolean> = {
  parse: (raw) => raw === 'yes',
  serialize: (seen) => (seen ? 'yes' : null),
}

/** Visual mode preferences, remembered per browser. */
export function useVisualPreferences() {
  const [ratio, setRatio] = useStoredState(RATIO_STORAGE_KEY, RATIO)
  const [width, setWidth] = useStoredState(WIDTH_STORAGE_KEY, WIDTH)
  const [lastMode, setLastMode] = useStoredState(MODE_STORAGE_KEY, MODE)
  const [showAreas, setShowAreas] = useStoredState(AREAS_STORAGE_KEY, AREAS)

  return {
    ratio,
    setRatio,
    width,
    setWidth,
    lastMode,
    setLastMode,
    showAreas,
    setShowAreas,
  }
}

/**
 * Whether the user has entered Visual mode before (the one-time "New" dot).
 * `seen` starts true so the server render and the first client render show
 * no dot; the stored value is read after mount.
 */
export function useVisualSeen() {
  const [seen, setSeen] = useStoredState(SEEN_STORAGE_KEY, SEEN, {
    serverValue: true,
  })
  const markSeen = React.useCallback(() => setSeen(true), [setSeen])
  return { seen, markSeen }
}
