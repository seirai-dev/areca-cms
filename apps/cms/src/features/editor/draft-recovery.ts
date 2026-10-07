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
