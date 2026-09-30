import * as React from 'react'

/**
 * Which floating surfaces are open right now, so the toaster can keep clear
 * of them: right slide-overs (by width), bottom sheets and floating bars.
 * Components register while open; the Toaster subscribes.
 */
type OverlayState = {
  /** Widest open right panel in px (desktop), 0 when none. */
  panelWidth: number
  /** A bottom sheet is open (phones). */
  sheet: boolean
  /** A floating bar (save pill, selection bar) is showing. */
  bar: boolean
}

type Entry = { kind: 'panel'; width: number } | { kind: 'sheet' | 'bar' }

const entries = new Map<symbol, Entry>()
const listeners = new Set<() => void>()
let snapshot: OverlayState = { panelWidth: 0, sheet: false, bar: false }

function emit() {
  let panelWidth = 0
  let sheet = false
  let bar = false
  for (const entry of entries.values()) {
    if (entry.kind === 'panel') panelWidth = Math.max(panelWidth, entry.width)
    else if (entry.kind === 'sheet') sheet = true
    else bar = true
  }
  snapshot = { panelWidth, sheet, bar }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const SERVER_SNAPSHOT: OverlayState = {
  panelWidth: 0,
  sheet: false,
  bar: false,
}

export function useOverlayState() {
  return React.useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  )
}

/** Registers an open overlay for as long as `entry` is non-null. */
export function useRegisterOverlay(entry: Entry | null) {
  const kind = entry?.kind
  const width = entry?.kind === 'panel' ? entry.width : 0
  React.useEffect(() => {
    if (!kind) return
    const id = Symbol(kind)
    entries.set(id, kind === 'panel' ? { kind, width } : { kind })
    emit()
    return () => {
      entries.delete(id)
      emit()
    }
  }, [kind, width])
}
