import * as React from 'react'
import { CopySimple } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { plainTextOf } from './seo-panel'

/**
 * Plain text of a field value, for the reference row. Rich text uses the
 * stored `markdown` when present, else the text of its JSON document.
 */
export function referenceText(type: string, value: unknown): string {
  if (type === 'richtext' && value && typeof value === 'object') {
    const markdown = (value as { markdown?: unknown }).markdown
    if (typeof markdown === 'string' && markdown.trim() !== '') {
      return markdown.trim()
    }
    return plainTextOf(value)
  }
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

/**
 * The main-language value shown above a translatable field, on a non-main
 * language (brief, content languages). Source first, then the translation:
 * line 1 is the language code and a quiet "Copy" text button, line 2 onward
 * is the value clamped to two lines. A left hairline, no card. The caller
 * puts it above the field and leaves an 8px gap to the field.
 */
export function MainReference({
  fieldKey,
  type,
  value,
  mainCode,
  mainName,
  onCopy,
}: {
  fieldKey: string
  type: string
  value: unknown
  /** Upper-case code of the main language, e.g. "NL". */
  mainCode: string
  /** Name of the main language in the CMS interface language, e.g. "Dutch". */
  mainName: string
  onCopy: (value: unknown) => void
}) {
  const text = referenceText(type, value)
  const empty = text === ''
  const [expanded, setExpanded] = React.useState(false)
  const [clamped, setClamped] = React.useState(false)
  const ref = React.useRef<HTMLParagraphElement>(null)

  React.useLayoutEffect(() => {
    const node = ref.current
    if (!node || expanded) return
    const measure = () => setClamped(node.scrollHeight > node.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [text, expanded])

  return (
    <div
      data-testid={`main-reference-${fieldKey}`}
      className="grid min-w-0 gap-0.5 border-l-2 border-border-default pl-2"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="text-[12px] leading-4 font-medium text-text-muted">
          {mainCode}
        </span>
        {empty ? null : (
          <Button
            type="button"
            variant="quiet"
            size="xs"
            aria-label={m.editor_language_copy_label({ language: mainName })}
            data-testid={`copy-from-main-${fieldKey}`}
            onClick={() => onCopy(value)}
            className="-my-1 -mr-1.5 h-6 px-1.5 text-[12px] text-text-secondary"
          >
            <CopySimple />
            {m.editor_language_copy()}
          </Button>
        )}
      </div>
      {empty ? (
        <p className="text-[13px] leading-5 text-text-muted italic">
          {m.editor_language_empty_in({ language: mainName })}
        </p>
      ) : (
        <p
          ref={ref}
          className={cn(
            'text-[13px] leading-5 text-text-secondary break-words',
            !expanded && 'line-clamp-2',
          )}
        >
          {text}
        </p>
      )}
      {!empty && (clamped || expanded) ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="w-fit text-[12px] leading-4 font-medium text-text-accent hover:underline"
          aria-expanded={expanded}
        >
          {expanded
            ? m.editor_language_show_less()
            : m.editor_language_show_more()}
        </button>
      ) : null}
    </div>
  )
}
