import * as React from 'react'
import { CaretDown, Key, Plus } from '@phosphor-icons/react'

import { CopyButton } from '#/components/ui/copy-button'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { Button } from '#/components/ui/button'
import { useShell } from '#/components/shell/shell-context'
import { mcpServerName } from '#/lib/mcp-install'
import type { MeSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'

import { CreateKeyDialog } from './create-key-dialog'
import { HowItWorks, PromptExamples, RoleNote } from './how-it-works'
import { KeysList, KeysListSkeleton } from './keys-list'
import { useMcpKeys } from './use-mcp-keys'

/**
 * Connect AI: create per-site keys for AI apps and see what is connected.
 * The page is for everyone on the site; what the key may do follows the
 * viewer's own role (the server decides, the copy only explains it).
 */
export function ConnectAiScreen({ site }: { site: MeSite }) {
  const { me } = useShell()
  const { keys, create, revoke } = useMcpKeys(site.id)
  const [createOpen, setCreateOpen] = React.useState(false)
  const data = keys.data
  const role = data?.role
  const showOwners = role === 'owner' || role === 'agency'

  return (
    <div className="grid gap-10 pb-24" data-testid="connect-ai">
      <PageHeader
        title={m.connect_ai_title()}
        description={m.connect_ai_description({ site: site.name })}
        actions={
          <Button
            type="button"
            size="lg"
            className="min-h-11 w-full sm:w-auto"
            onClick={() => setCreateOpen(true)}
            data-testid="connect-ai-create"
          >
            <Plus />
            {m.connect_ai_create_key()}
          </Button>
        }
      />

      <HowItWorks />

      {role ? <RoleNote role={role} /> : null}

      <PromptExamples />

      <section className="grid gap-3" aria-labelledby="connect-ai-keys-heading">
        <div className="grid gap-0.5 px-1">
          <h2
            id="connect-ai-keys-heading"
            className="text-headline text-text-primary"
          >
            {m.connect_ai_keys_title()}
          </h2>
          <p className="text-callout text-text-secondary">
            {showOwners
              ? m.connect_ai_keys_description_all()
              : m.connect_ai_keys_description_own()}
          </p>
        </div>

        {keys.isError ? (
          <QueryError
            title={m.connect_ai_keys_load_error()}
            error={keys.error}
            onRetry={() => void keys.refetch()}
            retrying={keys.isFetching}
          />
        ) : data ? (
          <KeysList
            keys={data.keys}
            currentUserId={me.user.id}
            showOwners={showOwners}
            onRevoke={(id) => revoke.mutateAsync(id)}
          />
        ) : (
          <KeysListSkeleton />
        )}
      </section>

      <Details
        endpointUrl={data?.endpointUrl}
        serverName={mcpServerName(site.slug)}
      />

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        site={{ id: site.id, name: site.name, slug: site.slug }}
        canAllowGoLive={data?.canAllowGoLive ?? false}
        create={(input) => create.mutateAsync(input)}
      />
    </div>
  )
}

/** For technical users: the raw endpoint, transport and header. */
function Details({
  endpointUrl,
  serverName,
}: {
  endpointUrl: string | undefined
  serverName: string
}) {
  return (
    <details
      className="group/details grid gap-4 rounded-card border border-border-default px-4 py-3 open:pb-4"
      data-testid="connect-ai-details"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[14px] leading-5 font-medium text-text-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2.5">
          <Key className="size-4 text-icon-muted" />
          {m.connect_ai_details()}
        </span>
        <CaretDown className="size-3.5 text-icon-muted transition-transform duration-150 group-open/details:rotate-180" />
      </summary>
      <dl className="grid gap-4 text-callout">
        <div className="grid gap-1.5">
          <dt className="text-caption text-text-muted">
            {m.connect_ai_details_endpoint()}
          </dt>
          <dd className="flex items-center gap-2">
            <code
              className="min-w-0 flex-1 overflow-x-auto rounded-control bg-background-subtle px-2.5 py-2 font-mono text-[12.5px] whitespace-nowrap text-text-primary"
              data-testid="connect-ai-endpoint"
            >
              {endpointUrl ?? '—'}
            </code>
            {endpointUrl ? (
              <CopyButton
                value={endpointUrl}
                variant="secondary"
                size="icon-sm"
                className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
              />
            ) : null}
          </dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[120px_minmax(0,1fr)]">
          <dt className="text-caption text-text-muted">
            {m.connect_ai_details_transport()}
          </dt>
          <dd className="text-text-primary">
            {m.connect_ai_details_transport_value()}
          </dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[120px_minmax(0,1fr)]">
          <dt className="text-caption text-text-muted">
            {m.connect_ai_details_header()}
          </dt>
          <dd>
            <code className="font-mono text-[12.5px] break-all text-text-primary">
              {m.connect_ai_details_header_value()}
            </code>
          </dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[120px_minmax(0,1fr)]">
          <dt className="text-caption text-text-muted">
            {m.connect_ai_details_server_name()}
          </dt>
          <dd>
            <code className="font-mono text-[12.5px] text-text-primary">
              {serverName}
            </code>
          </dd>
        </div>
      </dl>
    </details>
  )
}
