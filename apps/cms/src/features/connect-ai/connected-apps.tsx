import { Plug } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { InsetIcon, InsetList, InsetRow } from '#/components/ui/inset-list'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { Tag } from '#/components/ui/tag'
import type { ConnectTarget } from '#/lib/mcp-install'
import { absoluteTimeLabel, formatRelativeTime } from '#/lib/relative-time'
import { m } from '#/paraglide/messages'

import { formatDay } from './format'
import { RowActionButton, RowMeta } from './row-parts'

export type ConnectedApp = {
  id: string
  clientName: string
  userId: string
  userName: string | null
  allowGoLive: boolean
  createdAt: Date | string
  lastUsedAt: Date | string | null
}

/**
 * Apps connected to the site through sign-in. Each row says who connected it
 * (owners see everyone's), when, and when it was last used. Disconnect asks
 * first and takes effect on the app's next request.
 */
export function ConnectedAppsSection({
  target,
  connections,
  currentUserId,
  showOwners,
  onRetry,
  retrying,
  error,
  onDisconnect,
}: {
  target: ConnectTarget
  connections: ConnectedApp[] | undefined
  currentUserId: string
  showOwners: boolean
  error: unknown
  retrying: boolean
  onRetry: () => void
  onDisconnect: (id: string) => Promise<unknown>
}) {
  return (
    <section
      className="grid gap-5"
      aria-labelledby="connect-ai-connected-heading"
    >
      <div className="grid gap-1">
        <h2
          id="connect-ai-connected-heading"
          className="text-title-2 text-text-primary"
        >
          {m.connect_ai_connected_title()}
        </h2>
        <p className="text-callout text-text-secondary">
          {target.kind === 'agency'
            ? m.connect_ai_agency_connected_description()
            : showOwners
              ? m.connect_ai_connected_description_all()
              : m.connect_ai_connected_description()}
        </p>
      </div>

      {error ? (
        <QueryError
          title={m.connect_ai_connected_load_error()}
          error={error}
          onRetry={onRetry}
          retrying={retrying}
        />
      ) : connections === undefined ? (
        <div
          className="grid gap-2"
          aria-hidden="true"
          data-testid="connect-ai-connected-loading"
        >
          <Skeleton className="h-14 rounded-card" />
        </div>
      ) : connections.length === 0 ? (
        <EmptyState
          card
          size="sm"
          tone="neutral"
          icon={<Plug weight="duotone" />}
          title={m.connect_ai_connected_empty_title()}
          description={m.connect_ai_connected_empty_body()}
          data-testid="connect-ai-connected-empty"
        />
      ) : (
        <InsetList data-testid="connect-ai-connected">
          {connections.map((app) => (
            <ConnectedAppRow
              key={app.id}
              app={app}
              showBy={showOwners && app.userId !== currentUserId}
              target={target}
              onDisconnect={onDisconnect}
            />
          ))}
        </InsetList>
      )}
    </section>
  )
}

function ConnectedAppRow({
  app,
  showBy,
  target,
  onDisconnect,
}: {
  app: ConnectedApp
  showBy: boolean
  target: ConnectTarget
  onDisconnect: (id: string) => Promise<unknown>
}) {
  const parts = [
    ...(showBy
      ? [m.connect_ai_connected_by({ name: app.userName ?? '—' })]
      : []),
    m.connect_ai_connected_on({ date: formatDay(app.createdAt) }),
    app.lastUsedAt
      ? m.connect_ai_key_last_used({ when: formatRelativeTime(app.lastUsedAt) })
      : m.connect_ai_key_never_used(),
  ]
  return (
    <InsetRow
      inset={false}
      leading={
        <InsetIcon tone="accent">
          <Plug />
        </InsetIcon>
      }
      title={
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words">{app.clientName}</span>
          {app.allowGoLive ? (
            <Tag tone="accent" data-testid="connect-ai-connected-go-live">
              {m.connect_ai_key_can_go_live()}
            </Tag>
          ) : null}
        </span>
      }
      wrapSubtitle
      subtitle={
        <RowMeta items={parts} title={absoluteTimeLabel(app.createdAt)} />
      }
      trailing={
        <ConfirmDialog
          title={m.connect_ai_connected_disconnect_title({
            app: app.clientName,
          })}
          description={
            target.kind === 'agency'
              ? m.connect_ai_agency_connected_disconnect_description({
                  app: app.clientName,
                })
              : m.connect_ai_connected_disconnect_description({
                  app: app.clientName,
                })
          }
          confirmLabel={m.connect_ai_connected_disconnect_confirm()}
          variant="destructive"
          testId="connect-ai-disconnect-dialog"
          onConfirm={async () => {
            await onDisconnect(app.id)
            toast.success(
              m.connect_ai_connected_disconnected({ app: app.clientName }),
            )
          }}
        >
          <RowActionButton
            label={`${m.connect_ai_connected_disconnect()}: ${app.clientName}`}
            text={m.connect_ai_connected_disconnect()}
            data-testid="connect-ai-disconnect"
          />
        </ConfirmDialog>
      }
    />
  )
}
