import * as React from 'react'

import type { EntryData } from '#/lib/types'

import { DRAFT_WRITE_DELAY } from './editor-timing'

export function shouldKeepEditorOpen(outcome: string, dirty: boolean) {
  return outcome !== 'saved' || dirty
}

export function readRecoveredDraft(
  storage: Pick<Storage, 'getItem'>,
  key: string,
): EntryData | null {
  try {
    const stored = storage.getItem(key)
    const data = stored ? JSON.parse(stored)?.data : null
    return data && typeof data === 'object' && !Array.isArray(data)
      ? data
      : null
  } catch {
    return null
  }
}

export function persistDraft(
  storage: Pick<Storage, 'setItem'>,
  key: string,
  data: EntryData,
  version: number,
) {
  storage.setItem(
    key,
    JSON.stringify({ data, version, savedAt: new Date().toISOString() }),
  )
}

/**
 * Runs `write` once, `delay` ms after the last `schedule()`. `flush()` runs a
 * scheduled write now; with nothing scheduled it does nothing.
 */
export function createDraftWriter(write: () => void, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const run = () => {
    if (timer) clearTimeout(timer)
    timer = null
    write()
  }
  return {
    schedule() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(run, delay)
    },
    flush() {
      if (timer) run()
    },
  }
}

/**
 * The browser copy of unsaved edits (crash recovery), stored under `key`. It
 * is written once typing pauses, and at once when the tab is hidden or closed,
 * before navigation (`flush`) and on unmount. A stored copy that differs from
 * the server draft is offered as `recovered`.
 */
export function useDraftRecovery({
  key,
  ready,
  data,
  dirty,
  read,
  isDirty,
  baseline,
  onUnavailable,
}: {
  key: string
  /** The user is known and the server draft of this entry is loaded. */
  ready: boolean
  /** The draft, and whether it differs from the server's: schedule a write. */
  data: EntryData
  dirty: boolean
  /** The copy to store: the current draft and the version it is based on. */
  read: () => { data: EntryData; version: number }
  isDirty: () => boolean
  /** The server draft, serialised; a stored copy equal to it is not offered. */
  baseline: () => string
  /** The browser refused the write. */
  onUnavailable: () => void
}) {
  const [recovered, setRecovered] = React.useState<EntryData | null>(null)
  const latest = React.useRef({
    key,
    ready,
    read,
    isDirty,
    baseline,
    onUnavailable,
  })
  latest.current = { key, ready, read, isDirty, baseline, onUnavailable }
  // Reads only refs, so the writer made on the first render stays correct.
  const [writer] = React.useState(() =>
    createDraftWriter(() => {
      const current = latest.current
      if (!current.ready || !current.isDirty()) return
      const copy = current.read()
      try {
        persistDraft(localStorage, current.key, copy.data, copy.version)
      } catch {
        current.onUnavailable()
      }
    }, DRAFT_WRITE_DELAY),
  )
  const flush = writer.flush

  React.useEffect(() => {
    if (dirty && ready) writer.schedule()
  }, [data, dirty, key, ready, writer])

  React.useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  React.useEffect(() => {
    setRecovered(null)
    if (!ready) return
    const recovery = readRecoveredDraft(localStorage, key)
    if (recovery && JSON.stringify(recovery) !== latest.current.baseline())
      setRecovered(recovery)
  }, [key, ready])

  /** Forgets the stored copy and the offer. */
  const clear = React.useCallback(() => {
    try {
      localStorage.removeItem(latest.current.key)
    } catch {
      /* best effort */
    }
    setRecovered(null)
  }, [])

  return { recovered, setRecovered, clear, flush }
}
