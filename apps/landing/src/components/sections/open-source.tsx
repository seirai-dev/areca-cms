import { Star } from '@phosphor-icons/react'
import { m } from '@/paraglide/messages'
import { links } from '@/lib/links'
import { frond } from '../art/frond'
import { ButtonLink, Container } from '../ui'

const SPRIG = frond({
  base: { x: 20, y: 200 },
  control: { x: 140, y: 150 },
  tip: { x: 300, y: 30 },
  leaflets: 16,
  maxLength: 60,
  spread: 42,
  droop: 0.5,
})

export function OpenSource() {
  return (
    <section aria-labelledby="oss-title" className="py-12 sm:py-20">
      <Container>
        <div className="relative overflow-hidden rounded-[22px] bg-iris px-6 py-14 text-white sm:px-14 sm:py-20">
          <svg
            viewBox="0 0 320 220"
            className="pointer-events-none absolute -right-6 -bottom-10 w-[22rem] opacity-30 sm:w-[30rem]"
            aria-hidden="true"
            fill="none"
            stroke="#fff"
            strokeLinecap="round"
          >
            <path d={SPRIG.rachis} strokeWidth="2" />
            {SPRIG.leaflets.map((l, i) => (
              <path key={i} d={l.d} strokeWidth="1.2" />
            ))}
          </svg>
          <div className="relative max-w-[38rem]">
            <h2
              id="oss-title"
              className="text-[2.125rem] leading-[1.1] font-[620] tracking-[-0.035em] sm:text-title"
            >
              {m.oss_title()}
            </h2>
            <p className="mt-5 text-body text-white/80 sm:text-lead">
              {m.oss_body()}
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a
                href={links.github}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-small font-medium text-[#1d1d1f] transition-colors hover:bg-white/90"
              >
                <Star size={18} weight="fill" />
                {m.oss_cta()}
              </a>
              <span className="[&_a]:border-white/40 [&_a]:text-white [&_a:hover]:bg-white/10">
                <ButtonLink href={links.docs} variant="quiet">
                  {m.hero_cta_docs()}
                </ButtonLink>
              </span>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}
