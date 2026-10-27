import { m } from '#/paraglide/messages'

/** What the editor's save resolves to (see `useEntryEditor`'s `save`). */
export type SaveOutcome = 'saved' | 'failed' | 'blocked'

/**
 * Flushes the editor's pending save before a copy reads the saved draft.
 * Resolves only when the save landed; otherwise throws the same message the
 * editor shows when an action cannot save, so the copy never runs on stale data.
 */
export async function saveBeforeCopy(
  save: () => Promise<SaveOutcome>,
): Promise<void> {
  const outcome = await save()
  if (outcome === 'saved') return
  throw new Error(
    outcome === 'blocked'
      ? m.editor_add_title_first()
      : m.editor_fix_fields_first(),
  )
}
