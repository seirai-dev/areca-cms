import { Markdown } from '@tanstack/markdown/react'
import type { MarkdownComponents } from '@tanstack/markdown/react'
import { richTextDocument } from '@areca/site-sdk'
import type { RichTextValue } from '@areca/site-sdk'

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
        className="mt-12 scroll-mt-24 text-2xl font-semibold tracking-tight text-zinc-950"
      />
    )
  },
  h3(props) {
    return (
      <h3
        {...props}
        className="mt-8 scroll-mt-24 text-xl font-semibold tracking-tight text-zinc-900"
      />
    )
  },
  h4(props) {
    return (
      <h4
        {...props}
        className="mt-6 scroll-mt-24 text-base font-semibold uppercase tracking-wide text-zinc-700"
      />
    )
  },
  p(props) {
    return <p {...props} className="mt-5 text-lg leading-8 text-zinc-700" />
  },
  a(props) {
    const href = props.href ?? ''
    const external = /^https?:\/\//i.test(href)
    return (
      <a
        {...props}
        className="font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4 transition hover:decoration-zinc-950"
        rel={external ? 'noopener noreferrer' : props.rel}
        target={external ? '_blank' : props.target}
      />
    )
  },
  strong(props) {
    return <strong {...props} className="font-semibold text-zinc-950" />
  },
  em(props) {
    return <em {...props} className="italic" />
  },
  ul(props) {
    return (
      <ul
        {...props}
        className="mt-5 list-disc space-y-2 pl-6 text-lg leading-8 text-zinc-700 marker:text-zinc-400"
      />
    )
  },
  ol(props) {
    return (
      <ol
        {...props}
        className="mt-5 list-decimal space-y-2 pl-6 text-lg leading-8 text-zinc-700 marker:font-medium marker:text-zinc-500"
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
        className="mt-6 border-l-4 border-zinc-900 pl-6 text-xl italic text-zinc-800 [&>p]:mt-0"
      />
    )
  },
  pre(props) {
    return (
      <pre
        {...props}
        className="mt-6 overflow-x-auto rounded-lg bg-zinc-950 p-5 text-sm leading-6 text-zinc-100"
      />
    )
  },
  code(props) {
    return <code {...props} className="font-mono" />
  },
  img(props) {
    return (
      <figure className="mt-8">
        <img
          {...props}
          loading="lazy"
          className="h-auto w-full rounded-xl"
        />
        {props.alt ? (
          <figcaption className="mt-2 text-center text-sm text-zinc-500">
            {props.alt}
          </figcaption>
        ) : null}
      </figure>
    )
  },
  hr() {
    return <hr className="my-10 border-0 text-center text-2xl tracking-[1em] text-zinc-400 before:content-['···']" />
  },
  br() {
    return <br />
  },
} satisfies MarkdownComponents

export function ArticleBody({ body }: { body: RichTextValue | null | undefined }) {
  return (
    <div className="mt-8">
      <Markdown components={articleComponents}>{richTextDocument(body)}</Markdown>
    </div>
  )
}
