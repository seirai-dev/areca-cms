import { useId, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  Article,
  Browser,
  Images,
  MagnifyingGlass,
  MagnifyingGlassPlus,
  RocketLaunch,
  Translate,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { m } from '@/paraglide/messages'
import { Container, SectionHeader } from '../ui'
import { Shot } from '../shot'
import { ZoomViewer } from '../zoom-viewer'

type Feature = {
  key: string
  shot: string
  icon: Icon
  tab: () => string
  title: () => string
  body: () => string
  alt: () => string
}

const FEATURES: Array<Feature> = [
  {
    key: 'visual',
    shot: 'visual',
    icon: Browser,
    tab: m.feature_visual_tab,
    title: m.feature_visual_title,
    body: m.feature_visual_body,
    alt: m.feature_shot_alt_visual,
  },
  {
    key: 'editor',
    shot: 'editor',
    icon: Article,
    tab: m.feature_editor_tab,
    title: m.feature_editor_title,
    body: m.feature_editor_body,
    alt: m.feature_shot_alt_editor,
  },
  {
    key: 'languages',
    shot: 'languages',
    icon: Translate,
    tab: m.feature_languages_tab,
    title: m.feature_languages_title,
    body: m.feature_languages_body,
    alt: m.feature_shot_alt_languages,
  },
  {
    key: 'seo',
    shot: 'seo',
    icon: MagnifyingGlass,
    tab: m.feature_seo_tab,
    title: m.feature_seo_title,
    body: m.feature_seo_body,
    alt: m.feature_shot_alt_seo,
  },
  {
    key: 'releases',
    shot: 'golive',
    icon: RocketLaunch,
    tab: m.feature_releases_tab,
    title: m.feature_releases_title,
    body: m.feature_releases_body,
    alt: m.feature_shot_alt_releases,
  },
  {
    key: 'library',
    shot: 'library',
    icon: Images,
    tab: m.feature_library_tab,
    title: m.feature_library_title,
    body: m.feature_library_body,
    alt: m.feature_shot_alt_library,
  },
]

export function Features() {
  const [index, setIndex] = useState(0)
  const [zoomed, setZoomed] = useState(false)
  const reduced = useReducedMotion() ?? false
  const id = useId()
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const current = FEATURES[index]

  // Arrow keys move between tabs, as the ARIA tabs pattern expects.
  const onKey = (e: React.KeyboardEvent) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = (index + delta + FEATURES.length) % FEATURES.length
    setIndex(next)
    tabs.current[next]?.focus()
    tabs.current[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="scroll-mt-20 py-24 sm:py-36"
    >
      <Container>
        <SectionHeader
          id="features-title"
          title={m.features_title()}
          lead={m.features_lead()}
        />

        {/* Padding inside the scroller keeps focus rings and borders from being clipped. */}
        <div className="-mx-5 mt-12 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <div
            role="tablist"
            aria-label={m.features_tablist()}
            onKeyDown={onKey}
            className="flex w-max gap-2 p-1 sm:w-auto sm:flex-wrap"
          >
            {FEATURES.map((f, i) => {
              const selected = i === index
              const Icon = f.icon
              return (
                <button
                  key={f.key}
                  ref={(el) => {
                    tabs.current[i] = el
                  }}
                  role="tab"
                  id={`${id}-tab-${f.key}`}
                  aria-selected={selected}
                  aria-controls={`${id}-panel`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setIndex(i)}
                  className={`flex h-11 shrink-0 items-center gap-2.5 rounded-full border px-4 text-small font-medium whitespace-nowrap transition-colors duration-200 ${
                    selected
                      ? 'border-line-strong bg-raised text-fg'
                      : 'border-transparent text-muted hover:bg-raised/60 hover:text-fg'
                  }`}
                >
                  <Icon
                    size={18}
                    weight={selected ? 'fill' : 'regular'}
                    className={selected ? 'text-iris-ink' : 'text-faint'}
                  />
                  {f.tab()}
                </button>
              )
            })}
          </div>
        </div>

        <div
          role="tabpanel"
          id={`${id}-panel`}
          aria-labelledby={`${id}-tab-${current.key}`}
          className="mt-8"
        >
          <div className="grid gap-2 md:grid-cols-[minmax(0,22rem)_1fr] md:gap-10">
            <h3 className="text-[1.5rem] leading-tight font-semibold tracking-[-0.02em]">
              {current.title()}
            </h3>
            <p className="max-w-[44rem] text-body text-muted">
              {current.body()}
            </p>
          </div>
          <div className="relative mt-8 aspect-[1440/900]">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.button
                type="button"
                key={current.key}
                onClick={() => setZoomed(true)}
                aria-label={m.zoom_open()}
                className="group absolute inset-0 block w-full cursor-zoom-in rounded-[14px] text-left"
                initial={
                  reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.99 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: reduced ? 0.15 : 0.45,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <Shot name={current.shot} alt={current.alt()} />
                <span className="absolute right-3 bottom-3 flex items-center gap-2 rounded-full bg-bg/85 px-3 py-2 text-micro font-medium text-fg shadow-sm backdrop-blur-md transition-colors group-hover:bg-bg sm:right-5 sm:bottom-5">
                  <MagnifyingGlassPlus size={16} />
                  {m.zoom_badge()}
                </span>
              </motion.button>
            </AnimatePresence>
          </div>
        </div>
      </Container>
      <ZoomViewer
        open={zoomed}
        onClose={() => setZoomed(false)}
        name={current.shot}
        alt={current.alt()}
      />
    </section>
  )
}
