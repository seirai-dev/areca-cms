import type { ReactNode } from 'react'

export function Container({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`mx-auto w-full max-w-[1400px] px-5 sm:px-8 lg:px-10 ${className}`}
    >
      {children}
    </div>
  )
}

export function SectionHeader({
  id,
  title,
  lead,
}: {
  id?: string
  title: string
  lead?: ReactNode
}) {
  return (
    <header className="max-w-[44rem]">
      <h2
        id={id}
        className="text-[2.125rem] leading-[1.1] font-[620] tracking-[-0.035em] text-balance sm:text-title"
      >
        {title}
      </h2>
      {lead ? (
        <p className="mt-5 text-body text-muted sm:text-lead">{lead}</p>
      ) : null}
    </header>
  )
}

export function ButtonLink({
  href,
  children,
  variant = 'primary',
  external = false,
}: {
  href: string
  children: ReactNode
  variant?: 'primary' | 'quiet'
  external?: boolean
}) {
  const base =
    'inline-flex h-11 items-center gap-2 rounded-full px-5 text-small font-medium transition-colors duration-150'
  const styles =
    variant === 'primary'
      ? 'bg-iris text-white hover:bg-iris-hover'
      : 'border border-line-strong text-fg hover:border-fg/40 hover:bg-raised'
  return (
    <a
      href={href}
      className={`${base} ${styles}`}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      {children}
    </a>
  )
}

/** Renders text where `areca pull` style spans become inline code. */
export function WithCode({ text, terms }: { text: string; terms: string[] }) {
  const pattern = new RegExp(
    `(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'g',
  )
  return (
    <>
      {text.split(pattern).map((part, i) =>
        terms.includes(part) ? (
          <code key={i} className="code-inline">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  )
}
