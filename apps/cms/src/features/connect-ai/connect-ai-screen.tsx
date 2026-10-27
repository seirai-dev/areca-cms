import * as React from 'react'
import { CaretDown, Key } from '@phosphor-icons/react'

import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { useShell } from '#/components/shell/shell-context'
import { connectServerName } from '#/lib/mcp-install'
import type { ConnectTarget } from '#/lib/mcp-install'
import type { MeSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'
import type { McpKeySummary } from '#/server/mcp/keys'

import { ConnectApps, ConnectPrompt } from './connect-apps'
import { ConnectedAppsSection } from './connected-apps'
import { ConnectorUrlPanel } from './connector-url-panel'
import { CreateKeyDialog } from './create-key-dialog'
import { KeysSection } from './keys-section'
import { RoleNote } from './role-note'
import { TechnicalDetails } from './technical-details'
import { useMcpConnections } from './use-mcp-connections'
import { useMcpKeys } from './use-mcp-keys'

/**
 * Connect AI: one connector URL per site, a plain guide per AI app, the apps
 * already connected, and (under Advanced) personal keys for scripts. What an
 * app may do follows the signed-in person's own role; the copy only explains it.
 */
export function ConnectAiScreen({ site }: { site: MeSite }) {
  const { me } = useShell()
  const target: ConnectTarget = {
    kind: 'site',
    name: site.name,
    slug: site.slug,
  }
  const { keys, create, revoke } = useMcpKeys(site.id)
  const { connections, revoke: disconnect } = useMcpConnections(site.id)
  const [createOpen, setCreateOpen] = React.useState(false)
  const keyData = keys.data
  const role = keyData?.role
  const showOwners = role === 'owner' || role === 'agency'
  const connectorUrl = connections.data?.connectorUrl
  const serverName = connectServerName(target)

  return (
    <div
      className="grid w-full max-w-[760px] min-w-0 grid-cols-[minmax(0,1fr)] gap-14 pb-24"
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
        <ConnectorUrlPanel
          url={connectorUrl}
          body={m.connect_ai_url_body({ site: site.name })}
        />
      )}

      {connectorUrl ? (
        <>
          <ConnectApps
            input={{ name: serverName, url: connectorUrl }}
            target={target}
          />
          <ConnectPrompt url={connectorUrl} target={target} />
        </>
      ) : (
        <Skeleton className="h-64 rounded-card" />
      )}

      <ConnectedAppsSection
        target={target}
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
        target={target}
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
        target={target}
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
  target,
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
  target: ConnectTarget
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
      className="group/advanced rounded-card border border-border-default px-4 py-2 open:pb-6 sm:px-5"
      data-testid="connect-ai-advanced"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-headline text-text-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2.5">
          <Key className="size-4 text-icon-muted" />
          {m.connect_ai_advanced_title()}
        </span>
        <CaretDown className="size-3.5 text-icon-muted transition-transform duration-150 group-open/advanced:rotate-180" />
      </summary>

      {/* Content sits in its own grid: <details> does not lay out its
          children as grid items in every browser. */}
      <div className="grid gap-8 border-t border-border-default pt-5 mt-2">
        <p className="text-callout text-text-secondary">
          {m.connect_ai_advanced_description()}
        </p>

        <KeysSection
          target={target}
          keysLoaded={keysLoaded}
          keysError={keysError}
          keysRetrying={keysRetrying}
          onRetry={onRetry}
          currentUserId={currentUserId}
          showOwners={showOwners}
          onCreate={onCreate}
          onRevoke={onRevoke}
        />

        <TechnicalDetails endpointUrl={endpointUrl} serverName={serverName} />
      </div>
    </details>
  )
}
