import * as React from 'react'
import { useChildMatches, useNavigate } from '@tanstack/react-router'

import type { MeSite } from '#/lib/site-nav'
import type { Me } from '#/server/fn/me'

import { EditorScreen } from './editor-screen'

const NEW_ROUTE = '/_app/sites/$siteId/c/$collectionKey/new'
const ENTRY_ROUTE = '/_app/sites/$siteId/c/$collectionKey/$entryId'

/** Entries created in this tab, mapped to the editor session that made them. */
const adopted = new Map<string, string>()
let sessions = 0

/**
 * Hosts the editor for both editor routes from the collection layout, so a
 * new entry keeps the same editor instance (focus, scroll, undo history)
 * when its first autosave creates it and the URL becomes `/$entryId`
 * (brief §3.5). Opening another entry or another "New" starts a fresh one.
 */
export function useEditorMatch() {
  return useChildMatches({
    select: (matches) => {
      const leaf = matches.find(
        (match) => match.routeId === NEW_ROUTE || match.routeId === ENTRY_ROUTE,
      )
      if (!leaf) return null
      const params = leaf.params as { entryId?: string }
      return leaf.routeId === NEW_ROUTE
        ? { entryId: undefined as string | undefined }
        : { entryId: params.entryId }
    },
  })
}

export function EditorHost({
  me,
  site,
  collectionKey,
  entryId,
}: {
  me: Me
  site: MeSite
  collectionKey: string
  entryId: string | undefined
}) {
  const navigate = useNavigate()
  const newKey = React.useRef('')
  const previous = React.useRef<string | undefined | null>(null)
  // Arriving at "New" (first render, or from an entry) starts a new session.
  if (!entryId && previous.current !== undefined)
    newKey.current = `new-${++sessions}`
  previous.current = entryId
  const key = entryId ? (adopted.get(entryId) ?? entryId) : newKey.current

  return (
    <EditorScreen
      key={`${collectionKey}:${key}`}
      me={me}
      site={site}
      collectionKey={collectionKey}
      entryId={entryId}
      onCreated={(id) => {
        adopted.set(id, key)
        return navigate({
          to: '/sites/$siteId/c/$collectionKey/$entryId',
          params: { siteId: site.id, collectionKey, entryId: id },
          replace: true,
          viewTransition: false,
          resetScroll: false,
        })
      }}
      onDeleted={() =>
        navigate({
          to: '/sites/$siteId/c/$collectionKey',
          params: { siteId: site.id, collectionKey },
        })
      }
    />
  )
}
