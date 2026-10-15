import * as React from 'react'
import { LinkSimple } from '@phosphor-icons/react'

import { m } from '#/paraglide/messages'
import type { EntryData, Field } from '#/lib/types'

import { canTranslateField } from './translate-plan'

export type LocaleFields = {
  /** Language being edited. */
  active: string
  main: string
  mainName: string
  /** Flat view of the main language, for the reference rows. */
  mainView: EntryData
  isMain: boolean
  /**
   * AI translate one field into the active language. Null when AI is not set
   * up (or the entry is not saved yet), which hides the Translate action.
   */
  onTranslateField: ((key: string) => void) | null
  /** Key of the field whose translation is running, if any. */
  translatingKey: string | null
}

/**
 * Null on single-language sites and when the main language is active, so
 * the field components render exactly as before in those cases.
 */
export const LocaleFieldsContext = React.createContext<LocaleFields | null>(
  null,
)

export function useLocaleFields() {
  return React.useContext(LocaleFieldsContext)
}

/** "Same in all languages", shown next to a shared field's label. */
export function SharedMarker() {
  return (
    <span className="inline-flex items-center gap-1 text-caption font-normal text-text-muted">
      <LinkSimple aria-hidden="true" className="size-3.5" />
      {m.editor_language_shared_marker()}
    </span>
  )
}

/** Translate props for a field's reference row, or nothing when unavailable. */
export function translateProps(locale: LocaleFields | null, field: Field) {
  if (!locale?.onTranslateField || !canTranslateField(field)) return {}
  const onTranslate = locale.onTranslateField
  return {
    onTranslate: () => onTranslate(field.key),
    translating: locale.translatingKey === field.key,
  }
}
