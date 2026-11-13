import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useStepUp } from '#/features/security/step-up'
import { errorMessage } from '#/lib/errors'
import { queryKeys } from '#/lib/content/query-keys'
import { m } from '#/paraglide/messages'
import {
  getAiSettingsFn,
  listAiModelsFn,
  saveAiSettingsFn,
} from '#/server/fn/ai'

const aiSettingsQueryKey = ['ai-settings'] as const
const aiModelsQueryKey = ['ai-models'] as const

export const AI_PROMPT_MAX_LENGTH = 20_000

/**
 * AI settings form state: the OpenRouter key (write-only), the model and the
 * system prompt are edited as a draft and saved together. Setting or
 * removing the key needs a fresh second factor (step-up).
 */
export function useAiSettings() {
  const queryClient = useQueryClient()
  const stepUp = useStepUp()
  const query = useQuery({
    queryKey: aiSettingsQueryKey,
    queryFn: () => getAiSettingsFn(),
  })
  const saved = query.data

  // The model list comes from OpenRouter; it changes slowly.
  const models = useQuery({
    queryKey: aiModelsQueryKey,
    queryFn: () => listAiModelsFn(),
    staleTime: 10 * 60_000,
    retry: false,
  })

  const [apiKey, setApiKey] = React.useState('')
  const [model, setModel] = React.useState('')
  const [prompt, setPrompt] = React.useState('')

  const seed = React.useCallback((view: NonNullable<typeof saved>) => {
    setApiKey('')
    setModel(view.model ?? '')
    setPrompt(view.systemPrompt ?? view.defaultSystemPrompt)
  }, [])

  // Independent image/key changes must not overwrite the metadata draft.
  const seeded = React.useRef(false)
  React.useEffect(() => {
    if (saved && !seeded.current) {
      seeded.current = true
      seed(saved)
    }
  }, [saved, seed])

  const save = useMutation({
    mutationFn: () => {
      const key = apiKey.trim()
      const input = {
        model: model.trim() || null,
        // The default text is stored as null so it keeps following updates.
        systemPrompt:
          saved && prompt.trim() === saved.defaultSystemPrompt.trim()
            ? null
            : prompt,
      }
      return key
        ? stepUp.run(() =>
            saveAiSettingsFn({ data: { ...input, apiKey: key } }),
          )
        : saveAiSettingsFn({ data: input })
    },
    onSuccess: (next) => {
      seed(next)
      toast.success(m.agency_ai_saved())
      queryClient.setQueryData(aiSettingsQueryKey, next)
      // Editors' "Generate with AI" depends on this; don't wait for staleTime.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.aiAvailability(),
      })
    },
    // Only the confirm dialog removes the key; it shows the error.
  })

  const removeKey = useMutation({
    mutationFn: () =>
      stepUp.run(() => saveAiSettingsFn({ data: { clearApiKey: true } })),
    onSuccess: (next) => {
      toast.success(m.agency_ai_key_removed())
      queryClient.setQueryData(aiSettingsQueryKey, next)
      void queryClient.invalidateQueries({
        queryKey: queryKeys.aiAvailability(),
      })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const promptEmpty = prompt.trim().length === 0
  const promptTooLong = prompt.length > AI_PROMPT_MAX_LENGTH

  const dirty = saved
    ? apiKey.trim().length > 0 ||
      model.trim() !== (saved.model ?? '') ||
      prompt !== (saved.systemPrompt ?? saved.defaultSystemPrompt)
    : false

  function submit() {
    if (promptEmpty || promptTooLong) return
    save.mutate()
  }

  return {
    query,
    saved,
    models,
    fields: { apiKey, model, prompt },
    set: { setApiKey, setModel, setPrompt },
    promptEmpty,
    promptTooLong,
    dirty,
    busy: save.isPending || removeKey.isPending,
    save,
    submit,
    discard: () => saved && seed(saved),
    removeKey,
  }
}
