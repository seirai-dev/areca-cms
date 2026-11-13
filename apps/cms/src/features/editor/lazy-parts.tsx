import * as React from 'react'

import type { AiSeoDialog as AiSeoDialogComponent } from './ai-seo-dialog'

/*
 * Editor parts most sessions never open, each in its own chunk: Preview mode
 * (the Markdown pipeline and the code highlighter) and the AI SEO dialog.
 */

const RichTextPreview = React.lazy(() =>
  import('./rich-text/rich-text-preview').then((module) => ({
    default: module.RichTextPreview,
  })),
)

const AiSeoDialog = React.lazy(() =>
  import('./ai-seo-dialog').then((module) => ({
    default: module.AiSeoDialog,
  })),
)

export function LazyRichTextPreview({ value }: { value: unknown }) {
  return (
    <React.Suspense fallback={null}>
      <RichTextPreview value={value} />
    </React.Suspense>
  )
}

/** Loads the dialog the first time it opens, then keeps it mounted. */
export function LazyAiSeoDialog(
  props: React.ComponentProps<typeof AiSeoDialogComponent>,
) {
  const [opened, setOpened] = React.useState(props.open)
  if (props.open && !opened) setOpened(true)
  if (!opened) return null
  return (
    <React.Suspense fallback={null}>
      <AiSeoDialog {...props} />
    </React.Suspense>
  )
}
