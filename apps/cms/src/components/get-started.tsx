import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { Check, CircleDashed } from '@phosphor-icons/react'

type Step = {
  title: string
  description: string
  done: boolean
  /** Missing while the step it depends on has not happened yet. */
  action?: ReactNode
}

/**
 * First-run checklist: the four things that stand between an empty instance
 * and a published site. Steps mark themselves done from live data, and each
 * one links to the place where it happens.
 */
export function GetStarted({
  hasOrganization,
  hasSite,
  hasCollection,
  isLive,
  siteId,
}: {
  hasOrganization: boolean
  hasSite: boolean
  hasCollection: boolean
  isLive: boolean
  siteId?: string
}) {
  const orgAction = (label: string) => (
    <Button asChild variant="ghost" size="sm">
      <Link to="/admin/organizations">{label}</Link>
    </Button>
  )

  const steps: Step[] = [
    {
      title: m.home_step_org_title(),
      description: m.home_step_org_description(),
      done: hasOrganization,
      action: orgAction(m.home_step_org_action()),
    },
    {
      title: m.home_step_site_title(),
      description: m.home_step_site_description(),
      done: hasSite,
      action: orgAction(m.home_step_site_action()),
    },
    {
      title: m.home_step_collection_title(),
      description: m.home_step_collection_description(),
      done: hasCollection,
      action: siteId ? (
        <Button asChild variant="ghost" size="sm">
          <Link to="/sites/$siteId" params={{ siteId }}>
            {m.home_step_collection_action()}
          </Link>
        </Button>
      ) : undefined,
    },
    {
      title: m.home_step_connect_title(),
      description: m.home_step_connect_description(),
      done: isLive,
      action: siteId ? (
        <Button asChild variant="ghost" size="sm">
          <Link to="/sites/$siteId/settings" params={{ siteId }}>
            {m.home_step_connect_action()}
          </Link>
        </Button>
      ) : undefined,
    },
  ]

  return (
    <section className="grid max-w-2xl gap-6" data-testid="get-started">
      <div className="grid gap-1">
        <h2 className="text-ds-heading-2">{m.home_get_started_title()}</h2>
        <p className="text-ds-body-sm text-text-secondary">
          {m.home_get_started_description()}
        </p>
      </div>
      <ol className="grid">
        {steps.map((step) => (
          <li
            key={step.title}
            className="flex items-start gap-3 border-b border-border-subtle py-4 first:pt-0 last:border-b-0 last:pb-0"
          >
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 [&>svg]:size-5',
                step.done ? 'text-icon-success' : 'text-icon-muted',
              )}
            >
              {step.done ? <Check weight="bold" /> : <CircleDashed />}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-ds-label-md',
                  step.done && 'text-text-muted line-through',
                )}
              >
                {step.title}
              </p>
              <p className="text-ds-body-xs text-text-secondary">
                {step.description}
              </p>
            </div>
            {step.done ? (
              <span className="text-ds-body-xs text-text-muted">
                {m.home_step_done()}
              </span>
            ) : (
              (step.action ?? null)
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
