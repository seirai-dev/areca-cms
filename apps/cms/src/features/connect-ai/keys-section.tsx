import { Plus } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { QueryError } from '#/components/ui/query-error'
import type { ConnectTarget } from '#/lib/mcp-install'
import { m } from '#/paraglide/messages'
import type { McpKeySummary } from '#/server/mcp/keys'

import { KeysList, KeysListSkeleton } from './keys-list'

/**
 * A person's AI keys with the button that makes a new one. Used by the site
 * page (under Advanced) and the agency page (a section of its own).
 */
export function KeysSection({
  target,
  keysLoaded,
  keysError,
  keysRetrying,
  onRetry,
  currentUserId,
  showOwners,
  onCreate,
  onRevoke,
}: {
  target: ConnectTarget
  keysLoaded: { keys: McpKeySummary[] } | undefined
  keysError: unknown
  keysRetrying: boolean
  onRetry: () => void
  currentUserId: string
  showOwners: boolean
  onCreate: () => void
  onRevoke: (id: string) => Promise<unknown>
}) {
  const agency = target.kind === 'agency'
  return (
    <section
      className="grid gap-4"
      aria-labelledby="connect-ai-keys-heading"
      data-testid="connect-ai-keys-section"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-0.5">
          <h2
            id="connect-ai-keys-heading"
            className="text-title-2 text-text-primary"
          >
            {agency
              ? m.connect_ai_agency_keys_title()
              : m.connect_ai_keys_title()}
          </h2>
          <p className="text-callout text-text-secondary">
            {agency
              ? m.connect_ai_agency_keys_description()
              : showOwners
                ? m.connect_ai_keys_description_all()
                : m.connect_ai_keys_description_own()}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="w-full sm:w-auto"
          onClick={onCreate}
          data-testid="connect-ai-create"
        >
          <Plus />
          {m.connect_ai_create_key()}
        </Button>
      </div>

      {keysError ? (
        <QueryError
          title={m.connect_ai_keys_load_error()}
          error={keysError}
          onRetry={onRetry}
          retrying={keysRetrying}
        />
      ) : keysLoaded ? (
        <KeysList
          keys={keysLoaded.keys}
          currentUserId={currentUserId}
          showOwners={showOwners}
          onRevoke={onRevoke}
        />
      ) : (
        <KeysListSkeleton />
      )}
    </section>
  )
}
