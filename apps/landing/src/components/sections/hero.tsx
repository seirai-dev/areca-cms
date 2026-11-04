import { useEffect, useRef, useState } from 'react'
import { BookOpen, GithubLogo, Play } from '@phosphor-icons/react'
import { useReducedMotion } from 'motion/react'
import { m } from '@/paraglide/messages'
import { links } from '@/lib/links'
import { HeroFronds } from '../art/hero-fronds'
import { ButtonLink, Container } from '../ui'
import { VideoDialog } from '../video-dialog'

export function Hero() {
  const [tourOpen, setTourOpen] = useState(false)
  const reduced = useReducedMotion() ?? false
  const loop = useRef<HTMLVideoElement>(null)

  // Respect reduced motion: keep the loop on its poster frame.
  useEffect(() => {
    const v = loop.current
    if (!v) return
    if (reduced) v.pause()
    else void v.play().catch(() => {})
  }, [reduced])

  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      <HeroFronds className="pointer-events-none absolute -top-24 right-[-18rem] w-[38rem] max-w-none opacity-30 sm:-top-10 sm:right-[-8rem] sm:w-[44rem] sm:opacity-90 lg:right-[-4rem] lg:w-[46rem]" />
      <Container className="relative pt-20 pb-16 sm:pt-28 lg:pt-36">
        <div className="max-w-[46rem]">
          <h1
            id="hero-title"
            className="text-[3.25rem] leading-[1.02] font-[640] tracking-[-0.045em] text-balance sm:text-[4.25rem] lg:text-display"
          >
            {m.hero_title()}
          </h1>
          <p className="mt-7 max-w-[38rem] text-lead text-muted">
            {m.hero_lead()}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <ButtonLink href={links.docs}>
              <BookOpen size={18} weight="bold" />
              {m.hero_cta_docs()}
            </ButtonLink>
            <ButtonLink href={links.github} variant="quiet" external>
              <GithubLogo size={18} weight="fill" />
              {m.hero_cta_github()}
            </ButtonLink>
          </div>
          <p className="mt-5 text-small text-faint">{m.hero_note()}</p>
        </div>

        <div className="relative mt-16 sm:mt-20">
          <div className="overflow-hidden rounded-[18px] border border-line bg-sunken shadow-[var(--shadow-frame)]">
            <video
              ref={loop}
              className="block aspect-video w-full"
              src="/video/areca-loop.mp4"
              poster="/video/poster.webp"
              autoPlay={!reduced}
              muted
              loop
              playsInline
              preload="metadata"
              aria-label={m.hero_video_label()}
            />
          </div>
          <button
            type="button"
            onClick={() => setTourOpen(true)}
            className="group absolute bottom-4 left-4 flex items-center gap-3 rounded-full bg-bg/85 py-2 pr-5 pl-2 text-left backdrop-blur-md transition-colors hover:bg-bg sm:bottom-6 sm:left-6"
          >
            <span className="grid size-10 place-items-center rounded-full bg-iris text-white transition-transform duration-200 group-hover:scale-105">
              <Play size={16} weight="fill" />
            </span>
            <span className="leading-tight">
              <span className="block text-small font-medium text-fg">
                {m.hero_watch()}
              </span>
              <span className="block text-micro text-muted">
                {m.hero_watch_length()}
              </span>
            </span>
          </button>
        </div>
      </Container>
      <VideoDialog open={tourOpen} onClose={() => setTourOpen(false)} />
    </section>
  )
}
