import * as React from 'react'
import { CaretDown, Key, Plus } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { useShell } from '#/components/shell/shell-context'
import { mcpServerName } from '#/lib/mcp-install'
import type { MeSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'
import type { McpKeySummary } from '#/server/mcp/keys'

import { ConnectApps } from './connect-apps'
import { ConnectedAppsSection } from './connected-apps'
import { ConnectorUrlPanel } from './connector-url-panel'
import { CreateKeyDialog } from './create-key-dialog'
import { KeysList, KeysListSkeleton } from './keys-list'
import { RoleNote } from './role-note'
import { useMcpConnections } from './use-mcp-connections'
import { useMcpKeys } from './use-mcp-keys'

/**
 * Connect AI: one connector URL per site, a plain guide per AI app, the apps
 * already connected, and (under Advanced) personal keys for scripts. What an
 * app may do follows the signed-in person's own role; the copy only explains it.
 */
export function ConnectAiScreen({ site }: { site: MeSite }) {
  const { me } = useShell()
  const { keys, create, revoke } = useMcpKeys(site.id)
  const { connections, revoke: disconnect } = useMcpConnections(site.id)
  const [createOpen, setCreateOpen] = React.useState(false)
  const keyData = keys.data
  const role = keyData?.role
  const showOwners = role === 'owner' || role === 'agency'
  const connectorUrl = connections.data?.connectorUrl
  const serverName = mcpServerName(site.slug)

  return (
    <div
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-12 pb-24"
      data-testid="connect-ai"
    >
      <PageHeader
        title={m.connect_ai_title()}
        description={m.connect_ai_description({ site: site.name })}
      />

      {connections.isError ? (
        <QueryError
          title={m.connect_ai_connected_load_error()}
          error={connections.error}
          onRetry={() => void connections.refetch()}
          retrying={connections.isFetching}
        />
      ) : (
        <ConnectorUrlPanel url={connectorUrl} siteName={site.name} />
      )}

      {connectorUrl ? (
        <ConnectApps
          input={{ name: serverName, url: connectorUrl }}
          siteName={site.name}
        />
      ) : (
        <Skeleton className="h-64 rounded-card" />
      )}

      <ConnectedAppsSection
        connections={connections.data?.connections}
        currentUserId={me.user.id}
        showOwners={showOwners}
        error={connections.isError ? connections.error : null}
        retrying={connections.isFetching}
        onRetry={() => void connections.refetch()}
        onDisconnect={(id) => disconnect.mutateAsync(id)}
      />

      {role ? <RoleNote role={role} /> : null}

      <Advanced
        keysLoaded={keyData}
        keysError={keys.isError ? keys.error : null}
        keysRetrying={keys.isFetching}
        onRetry={() => void keys.refetch()}
        currentUserId={me.user.id}
        showOwners={showOwners}
        serverName={serverName}
        endpointUrl={connectorUrl}
        onCreate={() => setCreateOpen(true)}
        onRevoke={(id) => revoke.mutateAsync(id)}
      />

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        site={{ id: site.id, name: site.name, slug: site.slug }}
        canAllowGoLive={keyData?.canAllowGoLive ?? false}
        create={(input) => create.mutateAsync(input)}
      />
    </div>
  )
}

/**
 * Personal keys for scripts and apps that cannot sign in through a browser.
 * Collapsed by default, because most people never need one.
 */
function Advanced({
  keysLoaded,
  keysError,
  keysRetrying,
  onRetry,
  currentUserId,
  showOwners,
  serverName,
  endpointUrl,
  onCreate,
  onRevoke,
}: {
  keysLoaded: { keys: McpKeySummary[] } | undefined
  keysError: unknown
  keysRetrying: boolean
  onRetry: () => void
  currentUserId: string
  showOwners: boolean
  serverName: string
  endpointUrl: string | undefined
  onCreate: () => void
  onRevoke: (id: string) => Promise<unknown>
}) {
  return (
    <details
      className="group/advanced rounded-card border border-border-default px-4 py-3 open:pb-6 sm:px-5"
      data-testid="connect-ai-advanced"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[14px] leading-5 font-medium text-text-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2.5">
          <Key className="size-4 text-icon-muted" />
          {m.connect_ai_advanced_title()}
        </span>
        <CaretDown className="size-3.5 text-icon-muted transition-transform duration-150 group-open/advanced:rotate-180" />
      </summary>

      {/* Content sits in its own grid: <details> does not lay out its
          children as grid items in every browser. */}
      <div className="grid gap-8 pt-1">
        <p className="text-callout text-text-secondary">
          {m.connect_ai_advanced_description()}
        </p>

        <section
          className="grid gap-4"
          aria-labelledby="connect-ai-keys-heading"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="grid gap-0.5">
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
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="min-h-11 w-full sm:w-auto"
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

        <TechnicalDetails endpointUrl={endpointUrl} serverName={serverName} />
      </div>
    </details>
  )
}

/** For technical users: the transport, header and server name. */
function TechnicalDetails({
  endpointUrl,
  serverName,
}: {
  endpointUrl: string | undefined
  serverName: string
}) {
  return (
    <section
      className="grid gap-4 border-t border-border-default pt-6"
      aria-labelledby="connect-ai-details-heading"
      data-testid="connect-ai-details"
    >
      <h2
        id="connect-ai-details-heading"
        className="text-overline text-text-muted"
      >
        {m.connect_ai_details()}
      </h2>
      <dl className="grid gap-4 text-callout">
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
            {m.connect_ai_details_server_name()}
          </dt>
          <dd>
            <code className="font-mono text-[12.5px] text-text-primary">
              {serverName}
            </code>
          </dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[120px_minmax(0,1fr)]">
          <dt className="text-caption text-text-muted">
            {m.connect_ai_details_server_url()}
          </dt>
          <dd>
            <code className="font-mono text-[12.5px] break-all text-text-primary">
              {endpointUrl ?? '—'}
            </code>
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
      </dl>
    </section>
  )
}
