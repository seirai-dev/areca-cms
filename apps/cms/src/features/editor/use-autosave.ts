import * as React from 'react'
import { useBlocker } from '@tanstack/react-router'

import { shouldKeepEditorOpen } from './draft-recovery'
import { autosaveDelay } from './editor-timing'
import { isExplicitTrigger } from './save-intent'
import type { SaveTrigger } from './save-intent'

/** Navigation waits at most this long for a pending save. */
const LEAVE_WAIT = 3000

export type SaveOutcome = 'saved' | 'failed' | 'blocked'

/** What the autosave loop tells the one save it runs. */
export type SaveContext = {
  /** The save was asked for (Save, ⌘S, Mark ready), not a timer. Read now. */
  explicit: () => boolean
  /** The editor is being left. */
  leaving: () => boolean
  /** Lets navigation through until `promise` settles (the URL swap after create). */
  bypassUntil: (promise: Promise<unknown>) => void
}

const sleep = (ms: number) =>
  new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms))

/**
 * When the editor saves: 3s after the last change, but at most 10s after the
 * first unsaved change while typing (editor-timing.ts); on window blur and tab
 * hide; before navigation (up to 3s, asking only when it could not save); and
 * on `flush`. One save is in flight at a time; edits made meanwhile are saved
 * next.
 */
export function useAutosave({
  data,
  dirty,
  isDirty,
  save,
  beforeLeave,
}: {
  /** The draft; each change restarts the timer while `dirty`. */
  data: unknown
  dirty: boolean
  isDirty: () => boolean
  save: (context: SaveContext) => Promise<SaveOutcome>
  /** Runs before navigation is decided (writes the recovery copy). */
  beforeLeave: () => void
}) {
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  /** When the first change not yet saved was made; null when none is pending. */
  const firstChangeAtRef = React.useRef<number | null>(null)
  const runningRef = React.useRef<Promise<SaveOutcome> | null>(null)
  const pendingRef = React.useRef(false)
  /** The running save was asked for (⌘S, Save, an action), not a timer. */
  const explicitRef = React.useRef(false)
  /**
   * The last save that went through was not explicit, or none has gone through
   * on this page yet: an explicit save must still run, because a background save
   * before this page left the baseline behind the draft.
   */
  const unexplicitSaveRef = React.useRef(true)
  const leavingRef = React.useRef(false)
  const bypassRef = React.useRef(false)
  const saveRef = React.useRef(save)
  saveRef.current = save

  const [context] = React.useState<SaveContext>(() => ({
    explicit: () => explicitRef.current,
    leaving: () => leavingRef.current,
    bypassUntil: (promise) => {
      bypassRef.current = true
      void promise.finally(() => {
        bypassRef.current = false
      })
    },
  }))

  const cancel = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const run = React.useCallback((): Promise<SaveOutcome> => {
    if (runningRef.current) {
      pendingRef.current = true
      return runningRef.current
    }
    const explicitSaveDue = () =>
      explicitRef.current && unexplicitSaveRef.current
    // Set by a flush while this loop runs (read through a function: the loop
    // clears it before each save).
    const requested = () => pendingRef.current
    const loop = (async () => {
      // Yield first so `runningRef` is set before the loop can finish.
      await Promise.resolve()
      let outcome: SaveOutcome = 'saved'
      try {
        do {
          pendingRef.current = false
          if (!isDirty() && !explicitSaveDue()) break
          const explicit = explicitRef.current
          outcome = await saveRef.current(context)
          if (outcome !== 'saved') break
          unexplicitSaveRef.current = !explicit
        } while (requested() && (isDirty() || explicitSaveDue()))
      } finally {
        runningRef.current = null
        explicitRef.current = false
      }
      return outcome
    })()
    runningRef.current = loop
    return loop
  }, [isDirty, context])

  /**
   * Saves now. Only the triggers `isExplicitTrigger` names (Save, ⌘S, Mark
   * ready) are explicit; a background save never advances the heading baseline
   * or opens the section link dialog (decision 21).
   */
  const flush = React.useCallback(
    (trigger: SaveTrigger = 'background'): Promise<SaveOutcome> => {
      cancel()
      firstChangeAtRef.current = null
      if (isExplicitTrigger(trigger)) explicitRef.current = true
      return run()
    },
    [run, cancel],
  )

  const runRef = React.useRef(run)
  runRef.current = run

  // Debounce: save 3s after the last change, and at most 10s after the first
  // unsaved change (see editor-timing.ts). Each change restarts the timer.
  React.useEffect(() => {
    if (!dirty) {
      firstChangeAtRef.current = null
      return
    }
    if (firstChangeAtRef.current === null) firstChangeAtRef.current = Date.now()
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(
      () => {
        timerRef.current = null
        firstChangeAtRef.current = null
        void runRef.current()
      },
      autosaveDelay(Date.now(), firstChangeAtRef.current),
    )
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [data, dirty])

  // Blur of the window or a hidden tab saves at once.
  React.useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && isDirty())
        void flush('background')
    }
    const onBlur = () => {
      if (isDirty()) void flush('background')
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('blur', onBlur)
    }
  }, [flush, isDirty])

  // Leaving: wait (max 3s) for the save; ask only when it could not save.
  const blocker = useBlocker({
    shouldBlockFn: async ({ current, next }) => {
      beforeLeave()
      if (bypassRef.current) return false
      if (current.pathname === next.pathname) return false
      if (!isDirty() && !runningRef.current) return false
      leavingRef.current = true
      try {
        const outcome = await Promise.race([
          flush('background'),
          sleep(LEAVE_WAIT),
        ])
        return shouldKeepEditorOpen(outcome, isDirty())
      } finally {
        leavingRef.current = false
      }
    },
    enableBeforeUnload: () =>
      !bypassRef.current && (isDirty() || Boolean(runningRef.current)),
    withResolver: true,
  })

  return {
    flush,
    /** Drops a pending autosave timer. */
    cancel,
    /** Resolves once the save in flight, if any, has landed or failed. */
    settled: () => runningRef.current?.catch(() => undefined),
    /** Navigation from here on is not held for saving (the entry is gone). */
    bypass: () => {
      bypassRef.current = true
    },
    blocker,
    leaveAnyway: () => {
      bypassRef.current = true
      blocker.proceed?.()
    },
  }
}
