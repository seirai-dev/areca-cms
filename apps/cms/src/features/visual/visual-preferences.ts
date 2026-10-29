import * as React from 'react'

import { PREVIEW_WIDTHS } from './visual-layout'
import type { PreviewWidth } from './visual-layout'

/** The editor column's share of the layout, per browser. Null = default. */
export const RATIO_STORAGE_KEY = 'areca:visual:ratio'
/** The preview width preset, per browser. */
export const WIDTH_STORAGE_KEY = 'areca:visual:width'
/** The last editor mode, per browser. Mirrored in `?view=visual`. */
export const MODE_STORAGE_KEY = 'areca:editor:mode'
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

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    /* localStorage unavailable: the choice lasts for this page only */
  }
}

/**
 * Visual mode preferences, remembered per browser. Read once when the hook
 * mounts; the setters write through. Every access is guarded so private
 * modes and SSR never throw.
 */
export function useVisualPreferences() {
  const [ratio, setRatioState] = React.useState<number | null>(() =>
    parseStoredRatio(readStorage(RATIO_STORAGE_KEY)),
  )
  const [width, setWidthState] = React.useState<PreviewWidth>(() =>
    parseStoredWidth(readStorage(WIDTH_STORAGE_KEY)),
  )
  const [lastMode, setLastModeState] = React.useState<EditorMode | null>(() =>
    parseStoredMode(readStorage(MODE_STORAGE_KEY)),
  )

  const setRatio = React.useCallback((next: number | null) => {
    setRatioState(next)
    writeStorage(RATIO_STORAGE_KEY, next === null ? null : String(next))
  }, [])

  const setWidth = React.useCallback((next: PreviewWidth) => {
    setWidthState(next)
    writeStorage(WIDTH_STORAGE_KEY, next)
  }, [])

  const setLastMode = React.useCallback((next: EditorMode) => {
    setLastModeState(next)
    writeStorage(MODE_STORAGE_KEY, next)
  }, [])

  return { ratio, setRatio, width, setWidth, lastMode, setLastMode }
}

/**
 * Whether the user has entered Visual mode before (the one-time "New" dot).
 * `seen` starts true so the server render and the first client render show
 * no dot; the stored value is read after mount.
 */
export function useVisualSeen() {
  const [seen, setSeen] = React.useState(true)
  React.useEffect(() => {
    setSeen(readStorage(SEEN_STORAGE_KEY) === 'yes')
  }, [])
  const markSeen = React.useCallback(() => {
    setSeen(true)
    writeStorage(SEEN_STORAGE_KEY, 'yes')
  }, [])
  return { seen, markSeen }
}
