import { Link } from '@tanstack/react-router'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, Check } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import { CheckDraw } from '#/components/ui/status-pill'
import { SPRING_SMALL } from '#/lib/motion'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { useGettingStarted } from './use-getting-started'
import type { Step, StepKey, StepTarget } from './use-getting-started'

const COPY: Record<
  StepKey,
  { title: () => string; body: () => string; action: () => string }
> = {
  client: {
    title: () => m.agency_step_client_title(),
    body: () => m.agency_step_client_body(),
    action: () => m.agency_step_client_action(),
  },
  site: {
    title: () => m.agency_step_site_title(),
    body: () => m.agency_step_site_body(),
    action: () => m.agency_step_site_action(),
  },
  connect: {
    title: () => m.agency_step_connect_title(),
    body: () => m.agency_step_connect_body(),
    action: () => m.agency_step_connect_action(),
  },
  invite: {
    title: () => m.agency_step_invite_title(),
    body: () => m.agency_step_invite_body(),
    action: () => m.agency_step_invite_action(),
  },
  live: {
    title: () => m.agency_step_live_title(),
    body: () => m.agency_step_live_body(),
    action: () => m.agency_step_live_action(),
  },
}

/** A Link for a step target. Spreads the Button's slot props (class, ref). */
function StepLink({
  goal: target,
  children,
  ...rest
}: { goal: StepTarget; children: React.ReactNode } & Omit<
  React.ComponentProps<'a'>,
  'href' | 'children' | 'target'
>) {
  switch (target.kind) {
    case 'new-client':
      return (
        <Link {...rest} to="/agency/clients" search={{ new: 1 }}>
          {children}
        </Link>
      )
    case 'new-site':
      return target.orgId ? (
        <Link
          {...rest}
          to="/agency/clients/$orgId"
          params={{ orgId: target.orgId }}
          search={{ new: 1 }}
        >
          {children}
        </Link>
      ) : (
        <Link {...rest} to="/agency/clients">
          {children}
        </Link>
      )
    case 'developer':
      return (
        <Link
          {...rest}
          to="/sites/$siteId/settings"
          params={{ siteId: target.siteId }}
          search={{ tab: 'developer' }}
        >
          {children}
        </Link>
      )
    case 'people':
      return (
        <Link
          {...rest}
          to="/agency/clients/$orgId"
          params={{ orgId: target.orgId }}
          search={{ tab: 'people' }}
        >
          {children}
        </Link>
      )
    case 'go-live':
      return (
        <Link
          {...rest}
          to="/sites/$siteId"
          params={{ siteId: target.siteId }}
          search={{ panel: 'golive' }}
        >
          {children}
        </Link>
      )
  }
}

/**
 * "Get your agency ready" (brief §3.11): five steps computed from real data,
 * each with a direct action. The next step is open with its explanation and
 * the one primary button; the rest stay one line. Once everything is done it
 * collapses to a small "All set" line.
 */
export function GettingStarted() {
  const { steps, loading, doneCount, complete, current } = useGettingStarted()
  const reduce = useReducedMotion()

  if (loading) {
    return (
      <Skeleton
        className="h-[292px] rounded-card"
        data-testid="get-started-loading"
      />
    )
  }

  if (complete) {
    return (
      <div
        data-testid="get-started"
        data-complete="true"
        className="flex items-center gap-3 rounded-card border border-border-default bg-background-surface px-4 py-3 shadow-card"
      >
        <CheckDraw size={20} className="text-icon-success" />
        <p className="min-w-0 text-callout text-text-secondary">
          <span className="font-medium text-text-primary">
            {m.agency_checklist_all_set()}
          </span>
          {' · '}
          {m.agency_checklist_all_set_body()}
        </p>
      </div>
    )
  }

  const percent = Math.round((doneCount / steps.length) * 100)

  return (
    <Card
      padded={false}
      className="gap-0 overflow-hidden"
      data-testid="get-started"
    >
      <div className="grid gap-3 px-5 pt-5 pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-title-2 text-text-primary">
            {m.agency_checklist_title()}
          </h2>
          <span className="text-callout text-text-secondary tnum">
            {m.agency_checklist_progress({
              done: doneCount,
              total: steps.length,
            })}
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
          aria-label={m.agency_checklist_title()}
          className="h-1.5 overflow-hidden rounded-full bg-background-subtle"
        >
          <motion.div
            className="h-full rounded-full bg-accent"
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={reduce ? { duration: 0 } : SPRING_SMALL}
          />
        </div>
      </div>
      <ol className="border-t border-border-default">
        {steps.map((step, index) => (
          <StepRow
            key={step.key}
            step={step}
            index={index}
            isCurrent={step.key === current}
          />
        ))}
      </ol>
    </Card>
  )
}

function StepRow({
  step,
  index,
  isCurrent,
}: {
  step: Step
  index: number
  isCurrent: boolean
}) {
  const copy = COPY[step.key]
  return (
    <li
      data-testid={`get-started-${step.key}`}
      data-done={step.done ? 'true' : 'false'}
      className={cn(
        'relative flex items-start gap-3.5 px-5 py-3.5',
        'after:absolute after:right-0 after:bottom-0 after:left-[60px] after:h-px after:bg-border-default last:after:hidden',
        isCurrent &&
          'bg-[color-mix(in_oklab,var(--color-accent-soft)_35%,transparent)]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-px grid size-6 shrink-0 place-content-center rounded-full text-[12px] font-semibold tnum',
          step.done
            ? 'bg-status-success text-text-inverse'
            : isCurrent
              ? 'bg-accent text-accent-contrast'
              : 'border border-border-strong text-text-muted',
        )}
      >
        {step.done ? <Check weight="bold" className="size-3.5" /> : index + 1}
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p
          className={cn(
            'text-[14px] leading-6 font-medium',
            step.done ? 'text-text-muted' : 'text-text-primary',
          )}
        >
          {copy.title()}
          {step.done ? (
            <span className="sr-only"> ({m.agency_checklist_done()})</span>
          ) : null}
        </p>
        {isCurrent ? (
          <p className="text-callout text-text-secondary">{copy.body()}</p>
        ) : null}
      </div>
      {step.done ? (
        <span className="pt-0.5 text-caption font-normal text-text-muted">
          {m.agency_checklist_done()}
        </span>
      ) : step.target ? (
        <Button
          asChild
          variant={isCurrent ? 'primary' : 'quiet'}
          size="sm"
          data-testid={`get-started-${step.key}-action`}
        >
          <StepLink goal={step.target}>
            {copy.action()}
            {isCurrent ? <ArrowRight className="size-3.5" /> : null}
          </StepLink>
        </Button>
      ) : null}
    </li>
  )
}
