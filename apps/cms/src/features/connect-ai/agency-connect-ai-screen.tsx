import * as React from 'react'

import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { useShell } from '#/components/shell/shell-context'
import { connectServerName } from '#/lib/mcp-install'
import type { ConnectTarget } from '#/lib/mcp-install'
import { m } from '#/paraglide/messages'

import { ConnectApps, ConnectPrompt } from './connect-apps'
import { ConnectedAppsSection } from './connected-apps'
import { ConnectorUrlPanel } from './connector-url-panel'
import { CreateKeyDialog } from './create-key-dialog'
import { KeysSection } from './keys-section'
import { TechnicalDetails } from './technical-details'
import { useAgencyMcpConnections, useAgencyMcpKeys } from './use-agency-mcp'

const AGENCY_TARGET: ConnectTarget = { kind: 'agency' }
const AGENCY_SERVER_NAME = connectServerName(AGENCY_TARGET)

/**
 * Agency › Connect AI: the one connector for every client and site. Same
 * parts as a site's page (address, app guides, keys, connected apps), with
 * the agency copy. Keys and connections are the caller's own and never carry
 * go-live.
 */
export function AgencyConnectAiScreen() {
  const { me } = useShell()
  const { keys, create, revoke } = useAgencyMcpKeys()
  const { connections, revoke: disconnect } = useAgencyMcpConnections()
  const [createOpen, setCreateOpen] = React.useState(false)
  const connectorUrl = connections.data?.connectorUrl
  const connectedApps = connections.data?.connections.map((app) => ({
    ...app,
    // Agency connections are the caller's own, so the owner column is moot.
    userId: me.user.id,
    userName: null,
    allowGoLive: false,
  }))

  return (
    <div
      className="grid w-full max-w-[760px] min-w-0 grid-cols-[minmax(0,1fr)] gap-14 pb-24"
      data-testid="agency-connect-ai"
    >
      <PageHeader
        title={m.connect_ai_title()}
        description={m.connect_ai_agency_description()}
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
          body={m.connect_ai_agency_url_body()}
        />
      )}

      {connectorUrl ? (
        <>
          <ConnectApps
            input={{ name: AGENCY_SERVER_NAME, url: connectorUrl }}
            target={AGENCY_TARGET}
          />
          <ConnectPrompt url={connectorUrl} target={AGENCY_TARGET} />
        </>
      ) : (
        <Skeleton className="h-64 rounded-card" />
      )}

      <KeysSection
        target={AGENCY_TARGET}
        keysLoaded={keys.data}
        keysError={keys.isError ? keys.error : null}
        keysRetrying={keys.isFetching}
        onRetry={() => void keys.refetch()}
        currentUserId={me.user.id}
        showOwners={false}
        onCreate={() => setCreateOpen(true)}
        onRevoke={(id) => revoke.mutateAsync(id)}
      />

      <ConnectedAppsSection
        target={AGENCY_TARGET}
        connections={connectedApps}
        currentUserId={me.user.id}
        showOwners={false}
        error={connections.isError ? connections.error : null}
        retrying={connections.isFetching}
        onRetry={() => void connections.refetch()}
        onDisconnect={(id) => disconnect.mutateAsync(id)}
      />

      <TechnicalDetails
        endpointUrl={connectorUrl}
        serverName={AGENCY_SERVER_NAME}
      />

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        target={AGENCY_TARGET}
        canAllowGoLive={false}
        create={(input) => create.mutateAsync(input)}
      />
    </div>
  )
}
