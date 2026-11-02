import * as React from 'react'
import { ArrowSquareOut } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { CopyButton } from '#/components/ui/copy-button'
import { SlideOver } from '#/components/ui/slide-over'
import { m } from '#/paraglide/messages'

const TOKEN_PAGE = 'https://dash.cloudflare.com/profile/api-tokens'
const TOKEN_GUIDE =
  'https://developers.cloudflare.com/fundamentals/api/get-started/create-token/'

/** Cloudflare's own dashboard labels, kept in English on purpose. */
const PERMISSIONS = [
  'Account › Cloudflare Pages › Edit',
  'Account › Workers Scripts › Read',
  'Account › Workers Builds Configuration › Edit',
]

/**
 * Step-by-step setup for a client's Cloudflare connection. Mirrors what the
 * card asks for: a user token with three permissions, scoped to one account,
 * then the projects prepared for builds.
 */
export function CloudflareSetupGuide({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const steps: { title: string; body: string; extra?: React.ReactNode }[] = [
    {
      title: m.agency_cloudflare_guide_step_1_title(),
      body: m.agency_cloudflare_guide_step_1_body(),
    },
    {
      title: m.agency_cloudflare_guide_step_2_title(),
      body: m.agency_cloudflare_guide_step_2_body(),
    },
    {
      title: m.agency_cloudflare_guide_step_3_title(),
      body: m.agency_cloudflare_guide_step_3_body(),
      extra: (
        <div className="mt-2 grid gap-3">
          <ul
            data-testid="cloudflare-guide-permissions"
            aria-label={m.agency_cloudflare_guide_permissions_title()}
            className="grid gap-1.5 rounded-control bg-background-subtle px-3 py-2.5 font-mono text-[12.5px] text-text-primary"
          >
            {PERMISSIONS.map((permission) => (
              <li key={permission}>{permission}</li>
            ))}
          </ul>
          <div>
            <CopyButton
              value={PERMISSIONS.join('\n')}
              label={m.agency_cloudflare_guide_copy_permissions()}
              toastMessage={m.agency_cloudflare_guide_permissions_copied()}
              size="xs"
              data-testid="cloudflare-guide-copy-permissions"
            />
          </div>
        </div>
      ),
    },
    {
      title: m.agency_cloudflare_guide_step_4_title(),
      body: m.agency_cloudflare_guide_step_4_body(),
    },
    {
      title: m.agency_cloudflare_guide_step_5_title(),
      body: m.agency_cloudflare_guide_step_5_body(),
    },
    {
      title: m.agency_cloudflare_guide_step_6_title(),
      body: m.agency_cloudflare_guide_step_6_body(),
    },
    {
      title: m.agency_cloudflare_guide_step_7_title(),
      body: m.agency_cloudflare_guide_step_7_body(),
    },
    {
      title: m.agency_cloudflare_guide_step_8_title(),
      body: m.agency_cloudflare_guide_step_8_body(),
      extra: (
        <p className="mt-2 text-callout text-text-secondary">
          {m.agency_cloudflare_guide_step_8_env()}
        </p>
      ),
    },
    {
      title: m.agency_cloudflare_guide_step_9_title(),
      body: m.agency_cloudflare_guide_step_9_body(),
    },
  ]

  return (
    <SlideOver
      open={open}
      onOpenChange={onOpenChange}
      title={m.agency_cloudflare_guide_title()}
      description={m.agency_cloudflare_guide_description()}
      wrapDescription
      data-testid="cloudflare-guide"
    >
      <div className="grid gap-6">
        <p className="text-callout text-text-secondary">
          {m.agency_cloudflare_guide_intro()}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm">
            <a
              href={TOKEN_PAGE}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="cloudflare-guide-token-link"
            >
              {m.agency_cloudflare_guide_token_link()}
              <ArrowSquareOut />
            </a>
          </Button>
          <Button asChild variant="quiet" size="sm">
            <a
              href={TOKEN_GUIDE}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="cloudflare-guide-docs-link"
            >
              {m.agency_cloudflare_guide_docs_link()}
              <ArrowSquareOut />
            </a>
          </Button>
        </div>

        <ol className="grid gap-5" data-testid="cloudflare-guide-steps">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-content-center rounded-full bg-background-subtle text-caption font-medium text-text-secondary tnum">
                {index + 1}
              </span>
              <div className="grid min-w-0 flex-1 gap-1">
                <span className="text-headline text-text-primary">
                  {step.title}
                </span>
                <p className="text-callout text-text-secondary">{step.body}</p>
                {step.extra}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </SlideOver>
  )
}
