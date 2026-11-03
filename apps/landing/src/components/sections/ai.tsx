import { AnimatePresence, motion } from 'motion/react'
import { Check, Sparkle, Wrench, HourglassMedium } from '@phosphor-icons/react'
import { m } from '@/paraglide/messages'
import { useActive, useTicker } from '@/lib/use-active'
import { Container, SectionHeader } from '../ui'
import { CodeBlock } from '../code-block'

const enter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
}

export function Ai() {
  const { ref, active, still } = useActive<HTMLDivElement>()
  // 0 prompt, 1 tool call, 2 draft, 3 waiting, 4 approved, 5 hold.
  const tick = useTicker(active, 7, 1500)
  const step = still ? 4 : Math.min(tick, 5)
  return (
    <section
      aria-labelledby="ai-title"
      className="border-y border-line bg-sunken py-24 sm:py-36"
    >
      <Container className="grid grid-cols-1 items-start gap-14 lg:grid-cols-[1.05fr_1fr]">
        <div
          ref={ref}
          className="order-2 rounded-[18px] border border-line bg-bg p-5 sm:p-7 lg:order-1"
          role="img"
          aria-label={m.ai_art_label()}
        >
          <div className="flex min-h-[23rem] flex-col gap-4" aria-hidden="true">
            <motion.div
              {...enter}
              className="ml-auto max-w-[85%] rounded-[16px] rounded-br-md bg-iris px-4 py-3 text-small text-white"
            >
              {m.ai_art_prompt()}
            </motion.div>
            <AnimatePresence>
              {step >= 1 ? (
                <motion.div
                  key="tool"
                  {...enter}
                  className="flex items-center gap-2 self-start rounded-full border border-line px-3 py-1.5 font-mono text-micro text-muted"
                >
                  <Wrench size={14} className="text-iris-ink" />
                  {m.ai_art_tool()}
                  {step === 1 ? (
                    <span className="ml-1 size-1.5 animate-pulse rounded-full bg-iris-ink" />
                  ) : (
                    <Check size={13} className="text-live" />
                  )}
                </motion.div>
              ) : null}
              {step >= 2 ? (
                <motion.div
                  key="draft"
                  {...enter}
                  className="rounded-[14px] border border-line bg-raised p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="h-14 w-20 shrink-0 rounded-lg bg-[linear-gradient(160deg,#5a8f4e,#2f5a33_60%,#7aa36b)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-small font-semibold">
                        {m.ai_art_draft()}
                      </p>
                      <div className="mt-2 flex gap-1.5">
                        <span className="rounded border border-line px-1.5 text-[0.6875rem] text-muted">
                          EN
                        </span>
                        <span className="rounded border border-line px-1.5 text-[0.6875rem] text-muted">
                          NL
                        </span>
                      </div>
                    </div>
                    <StatusPill ready={step >= 4} />
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <div className="h-1.5 w-full rounded-full bg-line" />
                    <div className="h-1.5 w-4/5 rounded-full bg-line" />
                  </div>
                </motion.div>
              ) : null}
              {step === 3 ? (
                <motion.p
                  key="wait"
                  {...enter}
                  className="flex items-center gap-2 text-small text-muted"
                >
                  <HourglassMedium size={16} className="text-iris-ink" />
                  {m.ai_art_waiting()}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
        <div className="order-1 lg:order-2">
          <SectionHeader
            id="ai-title"
            title={m.ai_title()}
            lead={m.ai_lead()}
          />
          <ul className="mt-8 space-y-3">
            {[m.ai_point1(), m.ai_point2(), m.ai_point3()].map((p) => (
              <li key={p} className="flex gap-3 text-body text-muted">
                <Sparkle
                  size={18}
                  weight="fill"
                  className="mt-1 shrink-0 text-iris-ink"
                />
                {p}
              </li>
            ))}
          </ul>
          <div className="mt-10">
            <h3 className="text-body font-semibold">{m.ai_skills_title()}</h3>
            <p className="mt-1.5 text-small text-muted">{m.ai_skills_body()}</p>
            <CodeBlock
              className="mt-4"
              lines={[[{ t: 'npx ', c: 'f' }, { t: '@areca-cms/skills' }]]}
              prompt
            />
          </div>
        </div>
      </Container>
    </section>
  )
}

function StatusPill({ ready }: { ready: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-micro font-medium transition-colors duration-300 ${
        ready ? 'bg-iris-soft text-iris-ink' : 'bg-line/70 text-muted'
      }`}
    >
      <span
        className={`size-1.5 rounded-full ${ready ? 'bg-iris-ink' : 'bg-faint'}`}
      />
      {ready ? m.ai_art_status_ready() : m.ai_art_status_draft()}
    </span>
  )
}
