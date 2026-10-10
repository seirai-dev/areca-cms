import { Copy } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { Card } from '#/components/ui/card'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/** The three steps, in plain words. Numbers, not icons, so the order is clear. */
export function HowItWorks() {
  const steps = [
    { title: m.connect_ai_step_1_title(), body: m.connect_ai_step_1_body() },
    { title: m.connect_ai_step_2_title(), body: m.connect_ai_step_2_body() },
    { title: m.connect_ai_step_3_title(), body: m.connect_ai_step_3_body() },
  ]
  return (
    <section className="grid gap-3" aria-labelledby="connect-ai-steps">
      <h2 id="connect-ai-steps" className="px-1 text-overline text-text-muted">
        {m.connect_ai_steps_title()}
      </h2>
      <ol className="grid gap-3 md:grid-cols-3" data-testid="connect-ai-steps">
        {steps.map((step, index) => (
          <li key={step.title}>
            <Card className="h-full gap-2 p-4">
              <span className="grid size-7 place-content-center rounded-full bg-accent-soft text-[13px] font-semibold text-text-accent tnum">
                {index + 1}
              </span>
              <span className="grid gap-1">
                <span className="text-headline text-text-primary">
                  {step.title}
                </span>
                <span className="text-callout text-text-secondary">
                  {step.body}
                </span>
              </span>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** A role-specific sentence: what the viewer's AI is allowed to do here. */
export function RoleNote({ role }: { role: 'editor' | 'owner' | 'agency' }) {
  const text =
    role === 'editor'
      ? m.connect_ai_role_editor()
      : role === 'agency'
        ? m.connect_ai_role_agency()
        : m.connect_ai_role_owner()
  return (
    <p
      className="rounded-card bg-background-subtle px-4 py-3 text-callout text-text-secondary"
      data-testid="connect-ai-role-note"
    >
      {text}
    </p>
  )
}

/** Example requests the user can copy and paste into their AI app. */
export function PromptExamples() {
  const prompts = [
    m.connect_ai_prompt_blog(),
    m.connect_ai_prompt_page(),
    m.connect_ai_prompt_update(),
  ]
  return (
    <section className="grid gap-3" aria-labelledby="connect-ai-prompts">
      <div className="grid gap-0.5 px-1">
        <h2 id="connect-ai-prompts" className="text-headline text-text-primary">
          {m.connect_ai_prompts_title()}
        </h2>
        <p className="text-callout text-text-secondary">
          {m.connect_ai_prompts_hint()}
        </p>
      </div>
      <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {prompts.map((prompt) => (
          <li key={prompt}>
            <PromptChip text={prompt} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function PromptChip({ text }: { text: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(m.connect_ai_prompt_copied())
    } catch {
      toast.error(m.ui_copy_failed())
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      data-testid="connect-ai-prompt-chip"
      className={cn(
        'group/chip flex min-h-11 w-full items-center gap-2.5 rounded-control border border-border-default bg-background-surface px-3.5 py-2 text-left text-callout text-text-primary shadow-card',
        'transition-colors duration-150 hover:border-border-strong hover:bg-surface-state-hover',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        'active:bg-surface-state-pressed sm:w-auto sm:max-w-[360px]',
      )}
    >
      <span className="min-w-0 flex-1">{text}</span>
      <Copy className="size-4 shrink-0 text-icon-muted group-hover/chip:text-icon-accent" />
    </button>
  )
}
