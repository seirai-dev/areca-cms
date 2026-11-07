import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { errorMessage } from '#/lib/content/utils'
import { uiLanguageName } from '#/lib/site-languages'
import type { EntryData, Field } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { translateContentFn } from '#/server/fn/translate'

import {
  afterSave,
  emptyTargetKeys,
  fieldAttributeFor,
  fieldsToTranslate,
  isBlankValue,
  translatableSourceKeys,
  translationPatch,
} from './translate-plan'
import type { SaveOutcome } from './translate-plan'

/** Length of the accent highlight on translated fields. */
export const TRANSLATE_FLASH_MS = 1200

/**
 * Adds the highlight class to the rendered fields, so the CSS keyframes fade
 * the accent background out. Nothing animates under reduced motion.
 */
function flashFields(attributes: string[]) {
  if (typeof window === 'undefined') return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  for (const attribute of attributes) {
    const nodes = document.querySelectorAll<HTMLElement>(
      `[data-field="${CSS.escape(attribute)}"]`,
    )
    nodes.forEach((node) => {
      node.classList.remove('translate-flash')
      void node.offsetWidth
      node.classList.add('translate-flash')
      window.setTimeout(
        () => node.classList.remove('translate-flash'),
        TRANSLATE_FLASH_MS,
      )
    })
  }
}

type Variables = { keys: string[]; scope: string }

/**
 * AI translation for the active non-main language of an entry or section:
 * "Translate from <main>" for every empty field, and "Translate" per field
 * (with a confirm when the field already has text). The server returns values
 * without saving; `applyPatch` writes them as an ordinary draft edit.
 *
 * Every run saves first through `save` (the editor's Cmd/Ctrl+S path), so the
 * server translates the text the user sees. A failed save aborts the run and
 * shows the save error. `hasSource` is false when the main language has no
 * text, which disables the language action.
 *
 * `pendingScope` is "language" while the whole-language run is in flight, the
 * field key while a single field runs, else null. `dialog` renders the
 * replace-confirm and must be mounted by the screen.
 */
export function useAiTranslation({
  siteId,
  entryId,
  fields,
  main,
  active,
  source,
  target,
  seoEnabled,
  applyPatch,
  save,
}: {
  siteId: string
  entryId: string
  fields: Field[]
  main: string
  active: string
  /** Flat view of the main language. */
  source: EntryData
  /** Flat view of the active language. */
  target: EntryData
  seoEnabled: boolean
  applyPatch: (patch: EntryData) => void
  /** Saves the draft and resolves when it is done (editor.save). */
  save: () => Promise<SaveOutcome>
}) {
  const fromName = uiLanguageName(main)
  const toName = uiLanguageName(active)
  const [confirmKey, setConfirmKey] = React.useState<string | null>(null)
  const [preparing, setPreparing] = React.useState<string | null>(null)
  // Read after the save, so the send list uses the state the save left.
  const latest = React.useRef({ fields, source, target, seoEnabled })
  latest.current = { fields, source, target, seoEnabled }
  const hasSource =
    translatableSourceKeys({ fields, source, seoEnabled }).length > 0

  const run = useMutation({
    mutationFn: ({ keys }: Variables) =>
      translateContentFn({
        data: { siteId, entryId, from: main, to: active, fields: keys },
      }),
    onSuccess: (result) => {
      const { patch, applied } = translationPatch(target, result)
      if (applied.length === 0) {
        toast.message(m.editor_translate_nothing({ language: fromName }))
        return
      }
      applyPatch(patch)
      flashFields(applied.map(fieldAttributeFor))
      if (result.warnings.length) toast.message(result.warnings.join(' '))
      toast.success(
        applied.length === 1
          ? m.editor_translate_done_one({ language: fromName })
          : m.editor_translate_done_other({
              count: applied.length,
              language: fromName,
            }),
      )
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  /**
   * Saves, then runs `go`. Shows the save error and stops when the save fails.
   * `preparing` keeps the action's spinner on during the save.
   */
  async function saveThen(scope: string, go: () => void) {
    setPreparing(scope)
    try {
      const outcome = await afterSave(save, go)
      if (outcome !== 'saved') {
        toast.error(
          outcome === 'blocked'
            ? m.editor_add_title_first()
            : m.editor_fix_fields_first(),
        )
      }
    } finally {
      setPreparing(null)
    }
  }

  function translateLanguage() {
    void saveThen('language', () => {
      const current = latest.current
      const keys = fieldsToTranslate(current)
      if (keys.length === 0) {
        const gaps = emptyTargetKeys(current)
        toast.message(
          gaps.length === 0
            ? m.editor_translate_none({ language: toName })
            : m.editor_translate_no_source({ language: fromName }),
        )
        return
      }
      run.mutate({ keys, scope: 'language' })
    })
  }

  function runField(key: string) {
    const field = fields.find((item) => item.key === key)
    if (!field) return
    if (isBlankValue(field.type, latest.current.source[key])) {
      toast.message(m.editor_translate_no_source({ language: fromName }))
      return
    }
    run.mutate({ keys: [key], scope: key })
  }

  function translateField(key: string) {
    const field = fields.find((item) => item.key === key)
    if (!field) return
    if (isBlankValue(field.type, target[key])) {
      void saveThen(key, () => runField(key))
    } else {
      setConfirmKey(key)
    }
  }

  const dialog = (
    <ConfirmDialog
      open={confirmKey !== null}
      onOpenChange={(open) => {
        if (!open) setConfirmKey(null)
      }}
      title={m.editor_translate_replace_title({ language: toName })}
      confirmLabel={m.editor_translate_replace_confirm()}
      onConfirm={() => {
        const key = confirmKey
        setConfirmKey(null)
        if (key) void saveThen(key, () => runField(key))
      }}
      testId="translate-replace-confirm"
    />
  )

  return {
    translateLanguage,
    translateField,
    pendingScope: run.isPending ? run.variables.scope : preparing,
    hasSource,
    dialog,
  }
}
