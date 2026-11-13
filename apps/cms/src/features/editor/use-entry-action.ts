import { useMutation } from '@tanstack/react-query'

import type { SaveTrigger } from './save-intent'

/** What every entry action shares, from the editor. */
export type EntryActionDeps = {
  /** Shared by the editor's actions, so `busy` can count them. */
  mutationKey: readonly unknown[]
  /** Flushes the draft; the entry id, or null (with a toast) when it could not save. */
  ensureSaved: (trigger: SaveTrigger) => Promise<string | null>
  currentId: () => string | undefined
  invalidateEntry: (id: string) => Promise<void>
}

/**
 * One entry action: flush the draft first (unless `save` is 'none'), call the
 * server, toast and reload the entry and its lists. Resolves to null when the
 * draft could not be saved.
 */
export function useEntryAction<TInput = void>(
  deps: EntryActionDeps,
  {
    save,
    run,
    success,
    error,
  }: {
    save: SaveTrigger | 'none'
    run: (id: string, input: TInput) => Promise<unknown>
    success: (input: TInput) => void
    error: (error: unknown) => void
  },
) {
  return useMutation({
    mutationKey: deps.mutationKey,
    mutationFn: async (input: TInput) => {
      const id =
        save === 'none' ? deps.currentId()! : await deps.ensureSaved(save)
      if (!id) return null
      await run(id, input)
      return { id, input }
    },
    onSuccess: async (result) => {
      if (!result) return
      success(result.input)
      await deps.invalidateEntry(result.id)
    },
    onError: error,
  })
}
