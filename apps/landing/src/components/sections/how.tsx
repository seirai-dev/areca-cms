import { motion } from 'motion/react'
import { m } from '@/paraglide/messages'
import { useActive, useTicker } from '@/lib/use-active'
import { Container, SectionHeader, WithCode } from '../ui'

const X = [80, 305, 530, 755, 980]
const Y = 120
const STEP_MS = 1900

const steps = [
  { title: () => m.how_step1_title(), body: () => m.how_step1_body() },
  { title: () => m.how_step2_title(), body: () => m.how_step2_body() },
  { title: () => m.how_step3_title(), body: () => m.how_step3_body() },
  { title: () => m.how_step4_title(), body: () => m.how_step4_body() },
  { title: () => m.how_step5_title(), body: () => m.how_step5_body() },
]

export function How() {
  const { ref, active, still } = useActive<HTMLDivElement>()
  const tick = useTicker(active, 6, STEP_MS)
  // Step 5 holds the finished state for one extra beat before restarting.
  const step = still ? 4 : Math.min(tick, 4)

  return (
    <section
      id="how"
      aria-labelledby="how-title"
      className="scroll-mt-20 py-24 sm:py-36"
    >
      <Container>
        <SectionHeader
          id="how-title"
          title={m.how_title()}
          lead={m.how_lead()}
        />
        <div ref={ref}>
          {/* Wide screens: one horizontal stem through all five stages. */}
          <div className="mt-14 hidden overflow-hidden rounded-[18px] border border-line bg-raised/60 px-6 py-10 md:block">
            <PipelineArt step={step} />
          </div>
          <ol className="mt-10 hidden gap-6 md:grid md:grid-cols-5">
            {steps.map((s, i) => (
              <li key={i}>
                <StepNumber n={i} on={i <= step} />
                <h3 className="mt-4 text-body font-semibold">{s.title()}</h3>
                <p className="mt-1.5 text-small text-muted">
                  <WithCode text={s.body()} terms={['areca pull']} />
                </p>
              </li>
            ))}
          </ol>
          {/* Phones: the same pipeline as a vertical timeline with the text beside each stage. */}
          <ol className="mt-12 md:hidden" aria-label={m.how_art_label()}>
            {steps.map((s, i) => {
              const on = i <= step
              const last = i === steps.length - 1
              return (
                <li key={i} className="relative flex gap-4 pb-8 last:pb-0">
                  {!last ? (
                    <span
                      aria-hidden="true"
                      className="absolute top-14 bottom-0 left-[27px] w-0.5 bg-line-strong"
                    >
                      <span
                        className="block w-full bg-iris transition-[height] duration-700"
                        style={{ height: i < step ? '100%' : '0%' }}
                      />
                    </span>
                  ) : null}
                  <svg
                    viewBox="-34 -34 68 68"
                    className="relative size-14 shrink-0 overflow-visible"
                    aria-hidden="true"
                  >
                    <Station x={0} y={0} on={on} current={i === step} small>
                      {GLYPHS[i]}
                    </Station>
                  </svg>
                  <div className="pt-2.5">
                    <h3 className="text-body font-semibold">
                      <span className="mr-2 font-mono text-small text-faint">
                        {i + 1}
                      </span>
                      {s.title()}
                    </h3>
                    <p className="mt-1 text-small text-muted">
                      <WithCode text={s.body()} terms={['areca pull']} />
                    </p>
                    {CAPTIONS[i] ? (
                      <p className="mt-2 font-mono text-micro text-iris-ink">
                        {CAPTIONS[i]()}
                      </p>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </Container>
    </section>
  )
}

function PipelineArt({ step }: { step: number }) {
  return (
    <svg
      viewBox="0 0 1060 240"
      className="block h-auto w-full"
      role="img"
      aria-label={m.how_art_label()}
    >
      {/* The stem: a single gentle curve linking every stage. */}
      <path
        d={`M${X[0]} ${Y} C 300 ${Y - 26}, 760 ${Y + 26}, ${X[4]} ${Y}`}
        stroke="var(--line-strong)"
        strokeWidth="2"
        fill="none"
      />
      <motion.path
        d={`M${X[0]} ${Y} C 300 ${Y - 26}, 760 ${Y + 26}, ${X[4]} ${Y}`}
        stroke="var(--iris)"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        animate={{ pathLength: step / 4 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
      {X.map((x, i) => (
        <Station key={i} x={x} y={Y} on={i <= step} current={i === step}>
          {GLYPHS[i]}
        </Station>
      ))}
      {/* Captions under each station. */}
      <g
        fontFamily="var(--font-mono)"
        fontSize="16"
        fill="var(--fg-muted)"
        textAnchor="middle"
      >
        <text x={X[2]} y={Y + 82}>
          {m.how_art_snapshot()} 9f3c…a71e
        </text>
        <text x={X[3]} y={Y + 82}>
          $ {m.how_art_pull()}
        </text>
        <text x={X[4]} y={Y + 82}>
          {m.how_art_site()}
        </text>
      </g>
      {/* The entry travelling through the pipeline. */}
      <motion.g
        initial={false}
        animate={{ x: X[step] - 16, y: Y - 92 }}
        transition={{ type: 'spring', stiffness: 120, damping: 18 }}
      >
        <rect
          width="32"
          height="40"
          rx="6"
          fill="var(--bg-raised)"
          stroke="var(--iris-ink)"
          strokeWidth="1.5"
        />
        <path
          d="M8 12h16M8 19h16M8 26h10"
          stroke="var(--iris-ink)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <motion.circle
          cx="30"
          cy="4"
          r="7"
          animate={{
            fill:
              step === 0
                ? 'var(--fg-faint)'
                : step < 4
                  ? 'var(--iris)'
                  : 'var(--live)',
          }}
          transition={{ duration: 0.4 }}
        />
      </motion.g>
    </svg>
  )
}

function Station({
  x,
  y,
  on,
  current,
  small = false,
  children,
}: {
  x: number
  y: number
  on: boolean
  current: boolean
  small?: boolean
  children: React.ReactNode
}) {
  return (
    <g transform={`translate(${x} ${y})${small ? ' scale(0.76)' : ''}`}>
      <motion.circle
        r="44"
        fill="none"
        stroke="var(--iris)"
        initial={false}
        animate={{ opacity: current ? 0.35 : 0, scale: current ? 1 : 0.8 }}
        transition={{ duration: 0.5 }}
      />
      <circle
        r="34"
        fill="var(--bg)"
        stroke={on ? 'var(--iris)' : 'var(--line-strong)'}
        strokeWidth="2"
        style={{ transition: 'stroke .5s' }}
      />
      <g
        fill="none"
        stroke={on ? 'var(--fg)' : 'var(--fg-faint)'}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: 'stroke .5s' }}
      >
        {children}
      </g>
    </g>
  )
}

// Glyphs are drawn on a 32px grid centred on the station.
const DraftGlyph = () => (
  <g transform="translate(-14 -15)">
    <path d="M4 2h13l7 7v19H4z" />
    <path d="M17 2v7h7" />
    <path d="M9 22l9-9 3 3-9 9H9z" />
  </g>
)
const ReadyGlyph = () => (
  <g transform="translate(-14 -14)">
    <circle cx="14" cy="14" r="12" />
    <path d="M8 14.5l4 4 8-9" />
  </g>
)
const SnapshotGlyph = () => (
  <g transform="translate(-15 -15)">
    <path d="M15 2l12 6v14l-12 6-12-6V8z" />
    <path d="M3 8l12 6 12-6M15 14v14" />
  </g>
)
const PullGlyph = () => (
  <g transform="translate(-15 -13)">
    <rect x="1" y="1" width="28" height="24" rx="4" />
    <path d="M7 9l4 4-4 4M14 17h8" />
  </g>
)
const SiteGlyph = () => (
  <g transform="translate(-14 -14)">
    <circle cx="14" cy="14" r="12" />
    <path d="M2 14h24M14 2c4 4 4 20 0 24M14 2c-4 4-4 20 0 24" />
  </g>
)

const GLYPHS = [
  <DraftGlyph key="draft" />,
  <ReadyGlyph key="ready" />,
  <SnapshotGlyph key="snapshot" />,
  <PullGlyph key="pull" />,
  <SiteGlyph key="site" />,
]

const CAPTIONS: Array<(() => string) | null> = [
  null,
  null,
  () => `${m.how_art_snapshot()} 9f3c…a71e`,
  () => `$ ${m.how_art_pull()}`,
  null,
]

function StepNumber({ n, on }: { n: number; on: boolean }) {
  return (
    <span
      className={`flex size-7 items-center justify-center rounded-full font-mono text-micro transition-colors duration-500 ${
        on ? 'bg-iris text-white' : 'border border-line-strong text-faint'
      }`}
    >
      {n + 1}
    </span>
  )
}
