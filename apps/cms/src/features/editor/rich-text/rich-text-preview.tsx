import { useMemo } from 'react'
import { createTanStackMarkdownHighlighter } from '@tanstack/highlight/markdown'
import { Markdown } from '@tanstack/markdown/react'
import type { MarkdownComponents } from '@tanstack/markdown/react'

import { codeHighlighter } from '#/lib/highlight'
import { m } from '#/paraglide/messages'
import { isExternalHref } from '#/server/richtext/allowlist'
import { serializeMarkdown } from '#/server/richtext/markdown'

/** Same highlighter as the published html, so code looks the same here. */
const highlightCode = createTanStackMarkdownHighlighter(codeHighlighter)

/**
 * Read-only rendering of the editor's current content through the same
 * TanStack Markdown pipeline sites receive. Element styling here is only a
 * neutral stand-in: each site supplies its own component map.
 */
const previewComponents = {
  // The same link rule as the published html: external links open in a new tab.
  a(props) {
    return isExternalHref(props.href ?? '') ? (
      <a {...props} rel="noopener noreferrer" target="_blank" />
    ) : (
      <a {...props} />
    )
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
      <p className="py-3 text-body-lg text-text-muted">
        {m.editor_nothing_to_preview()}
      </p>
    )
  }

  return (
    <div
      className="prose max-w-none py-3 text-body-lg [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-[10px] [&_a]:underline"
      data-testid="rich-text-preview"
    >
      <Markdown components={previewComponents} highlighter={highlightCode}>
        {markdown}
      </Markdown>
    </div>
  )
}
