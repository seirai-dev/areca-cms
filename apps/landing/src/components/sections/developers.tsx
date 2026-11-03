import { motion } from 'motion/react'
import { CheckCircle } from '@phosphor-icons/react'
import { m } from '@/paraglide/messages'
import { useActive, useTicker } from '@/lib/use-active'
import { CodeBlock } from '../code-block'
import { Container, SectionHeader, WithCode } from '../ui'

export function Developers() {
  return (
    <section
      id="developers"
      aria-labelledby="dev-title"
      className="scroll-mt-20 py-24 sm:py-36"
    >
      <Container>
        <div className="grid grid-cols-1 gap-14 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <SectionHeader
              id="dev-title"
              title={m.dev_title()}
              lead={m.dev_lead()}
            />
            <ul className="mt-9 space-y-3.5">
              {[
                m.dev_point1(),
                m.dev_point2(),
                m.dev_point3(),
                m.dev_point4(),
              ].map((p) => (
                <li key={p} className="flex gap-3 text-body text-muted">
                  <CheckCircle
                    size={20}
                    weight="fill"
                    className="mt-0.5 shrink-0 text-iris-ink"
                  />
                  <span>
                    <WithCode text={p} terms={['areca.config.ts']} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0 space-y-4 lg:pt-2">
            <CodeBlock
              title={m.dev_code_install()}
              prompt
              lines={[
                [{ t: 'pnpm add ', c: 'f' }, { t: '@areca-cms/site-sdk' }],
                [{ t: 'pnpm exec areca ', c: 'f' }, { t: 'init' }],
                [{ t: 'pnpm exec areca ', c: 'f' }, { t: 'pull' }],
              ]}
            />
            <CodeBlock
              title={m.dev_code_read()}
              lines={[
                [
                  { t: 'import', c: 'k' },
                  { t: ' { content } ' },
                  { t: 'from', c: 'k' },
                  { t: " './generated/content/areca.gen'", c: 's' },
                ],
                [{ t: '' }],
                [
                  {
                    t: '// Typed from your schema. Read from local files.',
                    c: 'c',
                  },
                ],
                [
                  { t: 'const', c: 'k' },
                  { t: ' coffees = content.coffees.' },
                  { t: 'all', c: 'f' },
                  { t: '({ limit: 6 })' },
                ],
                [
                  { t: 'const', c: 'k' },
                  { t: ' geisha = content.coffees.' },
                  { t: 'get', c: 'f' },
                  { t: '(' },
                  { t: "'panama-boquete-geisha'", c: 's' },
                  { t: ')' },
                ],
                [{ t: '' }],
                [
                  { t: 'geisha?.data.tastingNotes ' },
                  { t: '// string', c: 'c' },
                ],
              ]}
            />
          </div>
        </div>
        <div className="mt-20 grid grid-cols-1 items-center gap-10 rounded-[18px] border border-line bg-raised/60 p-5 sm:p-8 lg:grid-cols-[1fr_1.2fr]">
          <div className="min-w-0">
            <h3 className="text-[1.375rem] leading-tight font-semibold tracking-[-0.02em]">
              {m.dev_visual_title()}
            </h3>
            <p className="mt-2 text-body text-muted">
              <WithCode text={m.dev_visual_body()} terms={['field()']} />
            </p>
            <CodeBlock
              className="mt-6"
              lines={[
                [
                  { t: '<h1 ' },
                  { t: '{...', c: 'k' },
                  { t: 'field', c: 'f' },
                  { t: '(' },
                  { t: "'name'", c: 's' },
                  { t: ')' },
                  { t: '}', c: 'k' },
                  { t: '>{coffee.data.name}</h1>' },
                ],
              ]}
            />
          </div>
          <ClickToEditArt />
        </div>
      </Container>
    </section>
  )
}

// Fields on the left, the site preview on the right. A cursor clicks the
// heading on the page and the matching field lights up.
function ClickToEditArt() {
  const { ref, active, still } = useActive<HTMLDivElement>()
  const tick = useTicker(active, 4, 1300)
  const phase = still ? 2 : tick // 0 rest, 1 hover, 2 clicked, 3 typing
  const cursor = phase === 0 ? { x: 470, y: 250 } : { x: 404, y: 104 }
  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-[14px] border border-line bg-bg"
    >
      <svg
        viewBox="0 0 560 320"
        className="block h-auto w-full"
        role="img"
        aria-label={m.dev_art_label()}
      >
        <rect x="0" y="0" width="200" height="320" fill="var(--bg-raised)" />
        <line x1="200" y1="0" x2="200" y2="320" stroke="var(--line)" />
        {/* Editor fields */}
        {[
          { y: 36, w: 120, key: 'name' },
          { y: 104, w: 90, key: 'origin' },
          { y: 172, w: 140, key: 'notes' },
        ].map((f) => {
          const on = f.key === 'name' && phase >= 2
          return (
            <g key={f.key}>
              <rect
                x="20"
                y={f.y}
                width="56"
                height="7"
                rx="3"
                fill="var(--fg-faint)"
                opacity=".6"
              />
              <rect
                x="20"
                y={f.y + 16}
                width="160"
                height="34"
                rx="8"
                fill="var(--bg)"
                stroke={on ? 'var(--iris-ink)' : 'var(--line-strong)'}
                strokeWidth={on ? 2 : 1.2}
                style={{ transition: 'stroke .25s' }}
              />
              <rect
                x="32"
                y={f.y + 30}
                width={f.key === 'name' && phase === 3 ? f.w + 14 : f.w}
                height="7"
                rx="3"
                fill="var(--fg-muted)"
                style={{ transition: 'width .4s' }}
              />
              {on ? (
                <rect
                  x={f.key === 'name' && phase === 3 ? 170 : 156}
                  y={f.y + 25}
                  width="1.6"
                  height="17"
                  fill="var(--iris-ink)"
                  className="animate-pulse"
                />
              ) : null}
            </g>
          )
        })}
        {/* Site preview */}
        <rect x="224" y="20" width="316" height="280" rx="10" fill="#f4efe6" />
        <rect
          x="244"
          y="40"
          width="60"
          height="7"
          rx="3"
          fill="#2f4b3a"
          opacity=".7"
        />
        <rect x="244" y="64" width="110" height="116" rx="8" fill="#5f8a55" />
        <path d="M244 160l30-28 22 18 26-30 32 40v20H244z" fill="#3d6440" />
        <g>
          <rect
            x="368"
            y="80"
            width="156"
            height="48"
            rx="4"
            fill="none"
            stroke="var(--iris)"
            strokeWidth="2"
            opacity={phase >= 1 ? 1 : 0}
            style={{ transition: 'opacity .2s' }}
          />
          {phase >= 1 ? (
            <g>
              <rect
                x="368"
                y="66"
                width="44"
                height="14"
                rx="3"
                fill="var(--iris)"
              />
              <text x="374" y="76.5" fontSize="9" fill="#fff" fontWeight="600">
                {m.dev_art_field()}
              </text>
            </g>
          ) : null}
          <rect x="376" y="90" width="132" height="11" rx="3" fill="#1d1d1f" />
          <rect
            x="376"
            y="108"
            width={phase === 3 ? 108 : 92}
            height="11"
            rx="3"
            fill="#1d1d1f"
            style={{ transition: 'width .4s' }}
          />
        </g>
        <rect
          x="376"
          y="146"
          width="56"
          height="9"
          rx="3"
          fill="#1d1d1f"
          opacity=".8"
        />
        {[0, 1, 2].map((i) => (
          <rect
            key={i}
            x={376 + i * 44}
            y="170"
            width="38"
            height="14"
            rx="7"
            fill="none"
            stroke="#1d1d1f"
            strokeOpacity=".3"
          />
        ))}
        {[0, 1, 2].map((i) => (
          <rect
            key={`r${i}`}
            x="244"
            y={206 + i * 26}
            width="276"
            height="1"
            fill="#1d1d1f"
            opacity=".12"
          />
        ))}
        {/* Cursor */}
        <motion.g
          initial={false}
          animate={cursor}
          transition={{ duration: 0.7, ease: [0.65, 0, 0.35, 1] }}
        >
          {phase === 2 ? (
            <motion.circle
              r="14"
              fill="none"
              stroke="var(--iris)"
              strokeWidth="2"
              initial={{ scale: 0.4, opacity: 1 }}
              animate={{ scale: 1.4, opacity: 0 }}
              transition={{ duration: 0.5 }}
            />
          ) : null}
          <path
            d="M0 0l13 7-5.7 1.4 3.2 6.4-2.5 1.2-3.2-6.4L0 14z"
            fill="#fff"
            stroke="#111"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </motion.g>
      </svg>
    </div>
  )
}
