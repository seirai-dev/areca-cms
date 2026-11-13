import * as React from 'react'

import type { PreviewPane as PreviewPaneComponent } from './preview-pane'

const PreviewPane = React.lazy(() =>
  import('./preview-pane').then((module) => ({ default: module.PreviewPane })),
)

/**
 * Visual mode's preview (live channel, click to edit) in its own chunk, so
 * opening the editor in Write mode does not download it.
 */
export function LazyPreviewPane(
  props: React.ComponentProps<typeof PreviewPaneComponent>,
) {
  return (
    <React.Suspense fallback={null}>
      <PreviewPane {...props} />
    </React.Suspense>
  )
}
