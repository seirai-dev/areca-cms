import { Link } from '@tanstack/react-router'
import { Sparkle } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { m } from '#/paraglide/messages'

/** Quiet overview entry point for Connect AI (every site member). */
export function ConnectAiCard({
  siteId,
  siteName,
}: {
  siteId: string
  siteName: string
}) {
  return (
    <Card
      padded={false}
      className="flex-row flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:flex-nowrap"
      data-testid="overview-connect-ai"
    >
      <span className="grid size-9 shrink-0 place-content-center rounded-[10px] bg-accent-soft text-icon-accent">
        <Sparkle className="size-[18px]" />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <h2 className="text-headline text-text-primary">
          {m.connect_ai_card_title()}
        </h2>
        <p className="text-callout text-text-secondary">
          {m.connect_ai_card_body({ site: siteName })}
        </p>
      </div>
      <Button
        asChild
        variant="secondary"
        className="min-h-11 w-full sm:min-h-9 sm:w-auto"
        data-testid="overview-connect-ai-link"
      >
        <Link to="/sites/$siteId/connect-ai" params={{ siteId }}>
          {m.connect_ai_card_link()}
        </Link>
      </Button>
    </Card>
  )
}
