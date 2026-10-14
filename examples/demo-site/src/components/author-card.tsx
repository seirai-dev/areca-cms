import { Link } from '@tanstack/react-router'
import type { AuthorsEntry } from '../generated/content/areca.gen.ts'
import { CmsImage } from './cms-image.tsx'
import { Eyebrow } from './ui.tsx'

export function AuthorCard({ author }: { author: AuthorsEntry }) {
  const { data } = author
  return (
    <article className="group flex flex-col">
      {data.portrait ? (
        <Link
          to="/team/$slug"
          params={{ slug: author.slug }}
          tabIndex={-1}
          aria-hidden="true"
          className="block overflow-hidden rounded-2xl bg-surface"
        >
          <CmsImage
            image={data.portrait}
            className="aspect-[4/5] w-full object-cover grayscale transition duration-700 ease-out group-hover:scale-[1.02] group-hover:grayscale-0"
          />
        </Link>
      ) : null}
      <div className="mt-6">
        {data.role ? <Eyebrow>{data.role}</Eyebrow> : null}
        <h2 className="mt-2 font-display text-3xl leading-tight tracking-tight text-ink">
          <Link to="/team/$slug" params={{ slug: author.slug }} className="transition-colors hover:text-accent-strong">
            {data.name}
          </Link>
        </h2>
        {data.bio ? <p className="mt-3 line-clamp-3 leading-7 text-muted">{data.bio}</p> : null}
      </div>
    </article>
  )
}
