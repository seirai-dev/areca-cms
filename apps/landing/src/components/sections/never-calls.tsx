import {
  CloudSlash,
  LockSimple,
  Gauge,
  ClockCounterClockwise,
} from '@phosphor-icons/react'
import { m } from '@/paraglide/messages'
import { useActive } from '@/lib/use-active'
import { Container, SectionHeader, WithCode } from '../ui'

const VISITORS = [28, 74, 120, 166, 212]

export function NeverCalls() {
  const { ref, active } = useActive<HTMLDivElement>()
  const points = [
    {
      icon: CloudSlash,
      title: m.home_point1_title(),
      body: m.home_point1_body(),
    },
    {
      icon: LockSimple,
      title: m.home_point2_title(),
      body: m.home_point2_body(),
    },
    { icon: Gauge, title: m.home_point3_title(), body: m.home_point3_body() },
    {
      icon: ClockCounterClockwise,
      title: m.home_point4_title(),
      body: m.home_point4_body(),
    },
  ]
  return (
    <section
      aria-labelledby="home-title"
      className="border-y border-line bg-sunken py-24 sm:py-36"
    >
      <Container>
        <SectionHeader
          id="home-title"
          title={m.home_title()}
          lead={<WithCode text={m.home_lead()} terms={['areca pull']} />}
        />
        <div
          ref={ref}
          data-active={active}
          className="group/flow mt-14 grid grid-cols-1 gap-5 lg:grid-cols-2"
          role="img"
          aria-label={m.home_art_label()}
        >
          <Panel
            title={m.home_typical()}
            caption={m.home_typical_caption()}
            muted
          >
            <TypicalArt />
          </Panel>
          <Panel title={m.home_areca()} caption={m.home_areca_caption()}>
            <ArecaArt />
          </Panel>
        </div>
        <dl className="mt-16 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
          {points.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <dt className="flex items-center gap-2.5 text-body font-semibold">
                <Icon size={20} className="text-iris-ink" />
                {title}
              </dt>
              <dd className="mt-2 text-small text-muted">{body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-12 max-w-[44rem] border-l-2 border-iris pl-4 text-small text-muted">
          {m.home_footnote()}
        </p>
      </Container>
    </section>
  )
}

function Panel({
  title,
  caption,
  muted,
  children,
}: {
  title: string
  caption: string
  muted?: boolean
  children: React.ReactNode
}) {
  return (
    <figure className="rounded-[18px] border border-line bg-bg p-5 sm:p-7">
      <figcaption>
        <p className={`text-body font-semibold ${muted ? 'text-muted' : ''}`}>
          {title}
        </p>
        <p className="mt-1 text-small text-muted">{caption}</p>
      </figcaption>
      <div className="mt-6">{children}</div>
    </figure>
  )
}

// Diagrams use a compact 400x260 canvas so labels stay large when scaled down.
const label = {
  fontSize: 15,
  fontWeight: 500,
  fill: 'var(--fg-muted)',
} as const

function Visitors() {
  return (
    <g>
      {VISITORS.map((y) => (
        <g key={y} transform={`translate(28 ${y})`}>
          <circle
            r="11"
            fill="none"
            stroke="var(--fg-muted)"
            strokeWidth="1.6"
          />
          <circle r="3.6" cy="-2" fill="var(--fg-muted)" />
        </g>
      ))}
      <text x="6" y="252" {...label}>
        {m.home_art_visitors()}
      </text>
    </g>
  )
}

const visitorPath = (y: number) => `M42 ${y} C 90 ${y}, 100 120, 150 120`

function TypicalArt() {
  return (
    <svg
      viewBox="0 0 400 262"
      className="block h-auto w-full"
      aria-hidden="true"
    >
      <Visitors />
      {VISITORS.map((y, i) => (
        <g key={y}>
          <path
            d={visitorPath(y)}
            fill="none"
            stroke="var(--line-strong)"
            strokeWidth="1.5"
          />
          <path
            d={`M222 120 C 250 120, 262 ${y}, 296 ${y}`}
            fill="none"
            stroke="var(--line-strong)"
            strokeWidth="1.5"
          />
          {/* A request per visitor: site to API and back, all day long. */}
          <path
            d={`M222 120 C 250 120, 262 ${y}, 296 ${y}`}
            fill="none"
            stroke="var(--iris-ink)"
            strokeWidth="2.4"
            strokeDasharray="8 120"
            className="flow-dash"
            style={{ animationDelay: `${i * -0.37}s` }}
          />
          <path
            d={visitorPath(y)}
            fill="none"
            stroke="var(--fg-muted)"
            strokeWidth="2.4"
            strokeDasharray="6 140"
            className="flow-dash"
            style={{ animationDelay: `${i * -0.52}s` }}
          />
        </g>
      ))}
      <rect
        x="150"
        y="94"
        width="72"
        height="52"
        rx="10"
        fill="var(--bg-raised)"
        stroke="var(--line-strong)"
        strokeWidth="1.5"
      />
      <text
        x="186"
        y="125"
        textAnchor="middle"
        fontSize="16"
        fontWeight="600"
        fill="var(--fg)"
      >
        {m.home_art_site()}
      </text>
      <rect
        x="296"
        y="14"
        width="96"
        height="212"
        rx="12"
        fill="var(--bg-raised)"
        stroke="var(--line-strong)"
        strokeWidth="1.5"
      />
      <text
        x="344"
        y="42"
        textAnchor="middle"
        fontSize="15"
        fontWeight="600"
        fill="var(--fg)"
      >
        {m.home_art_api()}
      </text>
      {/* A load meter that never quite rests. */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect
          key={i}
          x={314 + i * 11}
          y="168"
          width="7"
          height="44"
          rx="2"
          fill="var(--line-strong)"
        />
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect
          key={`b${i}`}
          x={314 + i * 11}
          y="168"
          width="7"
          height="44"
          rx="2"
          fill="var(--iris)"
          className="flow-meter"
          style={{
            animationDelay: `${i * -0.21}s`,
            transformOrigin: `${317.5 + i * 11}px 212px`,
          }}
        />
      ))}
    </svg>
  )
}

function ArecaArt() {
  return (
    <svg
      viewBox="0 0 400 262"
      className="block h-auto w-full"
      aria-hidden="true"
    >
      <Visitors />
      {VISITORS.map((y, i) => (
        <g key={y}>
          <path
            d={visitorPath(y)}
            fill="none"
            stroke="var(--line-strong)"
            strokeWidth="1.5"
          />
          <path
            d={visitorPath(y)}
            fill="none"
            stroke="var(--live)"
            strokeWidth="2.4"
            strokeDasharray="6 140"
            className="flow-dash"
            style={{ animationDelay: `${i * -0.52}s` }}
          />
        </g>
      ))}
      {/* Static files: a short stack of documents. */}
      <g transform="translate(150 78)">
        <rect
          x="9"
          y="-8"
          width="84"
          height="84"
          rx="10"
          fill="var(--bg-raised)"
          stroke="var(--line)"
        />
        <rect
          x="4.5"
          y="-4"
          width="84"
          height="84"
          rx="10"
          fill="var(--bg-raised)"
          stroke="var(--line-strong)"
        />
        <rect
          width="84"
          height="84"
          rx="10"
          fill="var(--bg-raised)"
          stroke="var(--live)"
          strokeWidth="1.8"
        />
        <path
          d="M16 26h40M16 40h52M16 54h32"
          stroke="var(--fg-muted)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <text x="44" y="106" textAnchor="middle" {...label}>
          {m.home_art_files()}
        </text>
      </g>
      {/* The CMS: off the request path, quiet until a build. */}
      <path
        d="M296 196 C 270 196, 252 186, 246 166"
        fill="none"
        stroke="var(--line-strong)"
        strokeWidth="1.5"
        strokeDasharray="4 6"
      />
      <path
        d="M296 196 C 270 196, 252 186, 246 166"
        fill="none"
        stroke="var(--iris-ink)"
        strokeWidth="3"
        strokeLinecap="round"
        pathLength="1"
        strokeDasharray="0.25 1"
        className="flow-build"
      />
      <text
        x="256"
        y="224"
        textAnchor="middle"
        {...label}
        className="flow-build-label"
      >
        {m.home_art_build()}
      </text>
      <g transform="translate(296 166)">
        <rect
          width="96"
          height="62"
          rx="12"
          fill="var(--bg-raised)"
          stroke="var(--line-strong)"
          strokeWidth="1.5"
        />
        <text
          x="48"
          y="28"
          textAnchor="middle"
          fontSize="15"
          fontWeight="600"
          fill="var(--fg)"
        >
          {m.home_art_cms()}
        </text>
        <path
          d="M36 42h24"
          stroke="var(--fg-faint)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <text
          x="70"
          y="47"
          fontSize="13"
          fill="var(--fg-muted)"
          className="flow-zzz"
        >
          z z
        </text>
      </g>
    </svg>
  )
}
