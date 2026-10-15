import * as React from 'react'
import { LinkSimple } from '@phosphor-icons/react'

import { m } from '#/paraglide/messages'
import type { EntryData } from '#/lib/types'

export type LocaleFields = {
  /** Language being edited. */
  active: string
  main: string
  mainName: string
  /** Flat view of the main language, for the reference rows. */
  mainView: EntryData
  isMain: boolean
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
