import { richTextComponents } from '@areca-cms/site-sdk/rich-text-react'
import { Markdown } from '@tanstack/markdown/react'
import type { MarkdownComponents } from '@tanstack/markdown/react'
import { richTextDocument } from '@areca-cms/site-sdk'
import type { RichTextValue } from '@areca-cms/site-sdk'

/**
 * The site owns how published content looks. The CMS ships a TanStack
 * Markdown document; every element below is a plain React component so the
 * site can restyle, wrap, or replace anything without touching the CMS.
 */
export const articleComponents = {
  h2(props) {
    return (
      <h2
        {...props}
        className="mt-16 scroll-mt-28 font-display text-3xl leading-tight tracking-tight text-ink md:text-4xl"
      />
    )
  },
  h3(props) {
    return (
      <h3
        {...props}
        className="mt-12 scroll-mt-28 font-display text-2xl leading-snug tracking-tight text-ink md:text-3xl"
      />
    )
  },
  h4(props) {
    return (
      <h4
        {...props}
        className="mt-10 scroll-mt-28 text-xs font-semibold uppercase tracking-[0.18em] text-muted"
      />
    )
  },
  p(props) {
    return <p {...props} className="mt-6 text-[1.125rem] leading-[1.8] text-ink/90" />
  },
  a(props) {
    const href = props.href ?? ''
    const external = /^https?:\/\//i.test(href)
    return (
      <a
        {...props}
        className="font-medium text-ink underline decoration-accent/60 decoration-[1.5px] underline-offset-[5px] transition-colors duration-200 hover:text-accent-strong hover:decoration-accent-strong"
        rel={external ? 'noopener noreferrer' : props.rel}
        target={external ? '_blank' : props.target}
      />
    )
  },
  strong(props) {
    return <strong {...props} className="font-semibold text-ink" />
  },
  em(props) {
    return <em {...props} className="italic" />
  },
  ul(props) {
    return (
      <ul
        {...props}
        className="mt-6 list-disc space-y-3 pl-6 text-[1.125rem] leading-[1.8] text-ink/90 marker:text-accent"
      />
    )
  },
  ol(props) {
    return (
      <ol
        {...props}
        className="mt-6 list-decimal space-y-3 pl-6 text-[1.125rem] leading-[1.8] text-ink/90 marker:font-display marker:text-accent-strong"
      />
    )
  },
  li(props) {
    return <li {...props} className="pl-1 [&>p]:mt-0" />
  },
  blockquote(props) {
    return (
      <blockquote
        {...props}
        className="my-14 border-l-2 border-accent py-1 pl-7 font-display text-2xl italic leading-snug tracking-tight text-ink md:text-3xl [&>p]:m-0 [&>p]:text-[inherit] [&>p]:leading-[inherit] [&>p]:italic"
      />
    )
  },
  pre(props) {
    return (
      <pre
        {...props}
        className="mt-8 overflow-x-auto rounded-2xl bg-brand p-6 text-sm leading-7 text-brand-ink"
      />
    )
  },
  code(props) {
    return <code {...props} className="rounded bg-surface px-1.5 py-0.5 font-mono text-[0.9em] text-ink ring-1 ring-inset ring-line" />
  },
  img(props) {
    return (
      <figure className="-mx-5 mt-12 sm:mx-0">
        <img
          {...props}
          loading="lazy"
          decoding="async"
          className="h-auto w-full rounded-2xl bg-surface"
        />
        {props.alt ? (
          <figcaption className="mt-3 px-5 text-center text-sm leading-6 text-muted sm:px-0">
            {props.alt}
          </figcaption>
        ) : null}
      </figure>
    )
  },
  hr() {
    return (
      <hr className="my-14 border-0 text-center font-display text-2xl tracking-[1em] text-accent before:content-['···']" />
    )
  },
  br() {
    return <br />
  },
} satisfies MarkdownComponents

export function ArticleBody({
  body,
}: {
  body: RichTextValue | null | undefined
}) {
  return (
    <div className="mt-10 max-w-[68ch]">
      <Markdown components={richTextComponents(articleComponents)}>
        {richTextDocument(body)}
      </Markdown>
    </div>
  )
}
