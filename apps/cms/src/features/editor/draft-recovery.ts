import type { EntryData } from '#/lib/types'

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
