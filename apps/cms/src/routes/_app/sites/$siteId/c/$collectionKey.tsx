import { Outlet, createFileRoute } from '@tanstack/react-router'

import { EditorHost, useEditorMatch } from '#/features/editor/editor-host'

/**
 * Collection layout. The editor routes (`new`, `$entryId`) render through
 * `EditorHost` here, so creating an entry swaps the URL without remounting
 * the editor; their own route components render nothing.
 */
export const Route = createFileRoute('/_app/sites/$siteId/c/$collectionKey')({
  component: CollectionLayout,
})

function CollectionLayout() {
  const { collectionKey } = Route.useParams()
  const { me, site } = Route.useRouteContext()
  const editor = useEditorMatch()
  if (!editor) return <Outlet />
  return (
    <>
      <EditorHost
        me={me}
        site={site}
        collectionKey={collectionKey}
        entryId={editor.entryId}
      />
      <Outlet />
    </>
  )
}
