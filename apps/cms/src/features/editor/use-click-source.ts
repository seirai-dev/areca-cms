import * as React from 'react'
import { useNavigate } from '@tanstack/react-router'

import { contentRoute } from '#/lib/content-route'
import { seoClickFields } from '#/features/visual/click-fields'
import type { ClickSource } from '#/features/visual/preview-pane'
import type { Field } from '#/lib/types'

import type { EntryEditorState } from './use-entry-editor'

/**
 * Click to edit (docs/design/visual-editor.md): the fields a preview may open,
 * and where "Open" goes. Opening another entry or section saves this one in
 * the background first, as leaving the editor does, so nothing typed here is
 * left behind.
 */
export function useClickSource({
  editor,
  siteId,
  fields,
  seo,
  globalKey,
  reveal,
}: {
  editor: EntryEditorState
  siteId: string
  fields: Field[]
  /** The SEO fields are shown, so the preview may open them. */
  seo: boolean
  /** The section being edited; null for a collection entry. */
  globalKey: string | null
  reveal: (key: string, options: { pulse: boolean }) => void
}): ClickSource {
  const navigate = useNavigate()
  const clickFields = React.useMemo(
    () => [
      ...fields.map((field) => ({ key: field.key, label: field.label })),
      ...(seo ? seoClickFields() : []),
    ],
    [fields, seo],
  )
  return {
    self: { entryId: editor.entryId ?? null, globalKey },
    fields: clickFields,
    onSelectField: (key) => reveal(key, { pulse: true }),
    onOpenOwner: (owner) => {
      void (async () => {
        await editor.persist().catch(() => null)
        await navigate({
          ...contentRoute({
            siteId,
            collectionKey:
              owner.kind === 'entry' ? owner.collectionKey : owner.globalKey,
            entryId: owner.entryId,
            global: owner.kind === 'global',
          }),
          search: { view: 'visual' },
        })
      })()
    },
  }
}
