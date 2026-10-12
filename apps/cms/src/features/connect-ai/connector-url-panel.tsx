import { CopyButton } from '#/components/ui/copy-button'
import { Skeleton } from '#/components/ui/skeleton'
import { m } from '#/paraglide/messages'

/**
 * The one primary action on Connect AI: the site's connector URL, with a
 * copy button. Every AI app takes this same URL.
 */
export function ConnectorUrlPanel({
  url,
  siteName,
}: {
  url: string | undefined
  siteName: string
}) {
  return (
    <section
      aria-labelledby="connect-ai-url-title"
      className="grid min-w-0 gap-5 overflow-hidden rounded-panel border border-border-default bg-background-surface p-5 shadow-card sm:p-6"
      data-testid="connect-ai-url-panel"
    >
      <div className="grid gap-1">
        <h2
          id="connect-ai-url-title"
          className="text-title-2 text-text-primary"
        >
          {m.connect_ai_url_title()}
        </h2>
        <p className="text-callout text-text-secondary">
          {m.connect_ai_url_body({ site: siteName })}
        </p>
      </div>
      {url ? (
        <div className="flex min-w-0 flex-col gap-2.5 sm:flex-row sm:items-center">
          <code
            className="scroll-quiet min-w-0 flex-1 overflow-x-auto rounded-control bg-background-subtle px-3 py-2.5 font-mono text-[13px] whitespace-nowrap text-text-primary"
            data-testid="connect-ai-endpoint"
          >
            {url}
          </code>
          <CopyButton
            value={url}
            label={m.connect_ai_url_copy()}
            variant="primary"
            size="lg"
            toastMessage={m.connect_ai_copied_toast()}
            className="min-h-11 w-full shrink-0 sm:w-auto"
            data-testid="connect-ai-url-copy"
          />
        </div>
      ) : (
        <Skeleton className="h-11 rounded-control" />
      )}
    </section>
  )
}
