import { useMemo } from 'react'
import { Markdown } from '@tanstack/markdown/react'
import type { MarkdownComponents } from '@tanstack/markdown/react'

import { serializeMarkdown } from '#/server/richtext/markdown'

/**
 * Read-only rendering of the editor's current content through the same
 * TanStack Markdown pipeline sites receive. Element styling here is only a
 * neutral stand-in: each site supplies its own component map.
 */
const previewComponents = {
  a(props) {
    return <a {...props} rel="noopener noreferrer" target="_blank" />
  },
  img(props) {
    return <img {...props} loading="lazy" />
  },
} satisfies MarkdownComponents

export function RichTextPreview({ value }: { value: unknown }) {
  const markdown = useMemo(
    () => (value && typeof value === 'object' ? serializeMarkdown(value) : ''),
    [value],
  )

  if (!markdown) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        Nothing to preview yet.
      </p>
    )
  }

  return (
    <div
      className="prose prose-sm max-w-none px-4 py-3 [&_img]:h-auto [&_img]:max-w-xs [&_a]:underline"
      data-testid="rich-text-preview"
    >
      <Markdown components={previewComponents}>{markdown}</Markdown>
    </div>
  )
}
