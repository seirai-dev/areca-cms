import type * as React from 'react'
import { CaretRight } from '@phosphor-icons/react'

import { CopyButton } from '#/components/ui/copy-button'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/**
 * A setup guide: numbered steps, each with its action (a button, a command)
 * directly under the sentence that asks for it.
 */
export function GuideSteps({ children }: { children: React.ReactNode }) {
  return <ol className="grid grid-cols-[minmax(0,1fr)] gap-6">{children}</ol>
}

/**
 * One step. `number` draws the badge; leave it out for a guide with a single
 * step, where "1" would only add noise.
 */
export function GuideStep({
  number,
  text,
  children,
}: {
  number?: number
  text: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <li
      className={cn(
        'grid min-w-0 gap-x-3.5',
        number === undefined
          ? 'grid-cols-[minmax(0,1fr)]'
          : 'grid-cols-[28px_minmax(0,1fr)]',
      )}
    >
      {number === undefined ? null : (
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-full border border-border-default bg-background-subtle font-mono text-caption text-text-secondary"
        >
          {number}
        </span>
      )}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 pt-[3px]">
        <p className="text-body text-text-primary">{text}</p>
        {children}
      </div>
    </li>
  )
}

/** A collapsed extra under a step ("Button not working?"). */
export function GuideDisclosure({
  summary,
  children,
}: {
  summary: string
  children: React.ReactNode
}) {
  return (
    <details className="group/disclosure min-w-0">
      <summary className="relative inline-flex cursor-pointer list-none items-center gap-1.5 rounded-[6px] text-callout text-text-secondary outline-none touch-target hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus [&::-webkit-details-marker]:hidden">
        <CaretRight className="size-3 shrink-0 transition-transform duration-150 group-open/disclosure:rotate-90" />
        {summary}
      </summary>
      <div className="grid grid-cols-[minmax(0,1fr)] pt-3">{children}</div>
    </details>
  )
}

/** The connector URL inline in a step, so nobody scrolls up to copy it. */
export function GuideUrl({ url }: { url: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-control border border-border-default bg-background-subtle py-1 ps-3 pe-1">
      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] leading-5 text-text-primary">
        {url}
      </code>
      <CopyButton
        value={url}
        label={m.connect_ai_copy_url()}
        variant="quiet"
        size="sm"
        toastMessage={m.connect_ai_copied_toast()}
        className="shrink-0"
        data-testid="connect-ai-step-url-copy"
      />
    </div>
  )
}

/** Something worth knowing but not needed to connect, set apart below. */
export function GuideOptional({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t border-border-default pt-6">
      <div className="grid gap-1">
        <span className="text-overline text-text-muted">
          {m.connect_ai_optional()}
        </span>
        <h3 className="text-headline text-text-primary">{title}</h3>
        <p className="text-callout text-text-secondary">{description}</p>
      </div>
      {children}
    </div>
  )
}
