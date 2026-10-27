import { Key } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { InsetIcon, InsetList, InsetRow } from '#/components/ui/inset-list'
import { Skeleton } from '#/components/ui/skeleton'
import { Tag } from '#/components/ui/tag'
import { errorMessage } from '#/lib/admin/helpers'
import { formatRelativeTime, absoluteTimeLabel } from '#/lib/relative-time'
import { m } from '#/paraglide/messages'
import type { McpKeySummary } from '#/server/mcp/keys'

import { formatDay } from './format'
import { RowActionButton, RowMeta } from './row-parts'

/**
 * The site's keys as an inset list. Each row shows when it was made, when it
 * was last used and when it stops working. Revoke asks first.
 */
export function KeysList({
  keys,
  currentUserId,
  showOwners,
  onRevoke,
}: {
  keys: McpKeySummary[]
  currentUserId: string
  /** Owners and agency admins see keys made by other people too. */
  showOwners: boolean
  onRevoke: (id: string) => Promise<unknown>
}) {
  if (keys.length === 0) {
    return (
      <EmptyState
        card
        size="sm"
        tone="neutral"
        icon={<Key weight="duotone" />}
        title={m.connect_ai_keys_empty_title()}
        description={m.connect_ai_keys_empty_body()}
        data-testid="connect-ai-keys-empty"
      />
    )
  }

  return (
    <InsetList data-testid="connect-ai-keys">
      {keys.map((key) => {
        const expired =
          key.expiresAt !== null && new Date(key.expiresAt) <= new Date()
        const mine = key.userId === currentUserId
        const subtitleParts = [
          m.connect_ai_key_created({ date: formatDay(key.createdAt) }),
          key.lastUsedAt
            ? m.connect_ai_key_last_used({
                when: formatRelativeTime(key.lastUsedAt),
              })
            : m.connect_ai_key_never_used(),
          key.expiresAt
            ? m.connect_ai_key_expires({ date: formatDay(key.expiresAt) })
            : m.connect_ai_key_never_expires(),
        ]
        if (showOwners && !mine) {
          subtitleParts.unshift(
            m.connect_ai_key_by({ name: key.userName ?? '—' }),
          )
        }
        return (
          <InsetRow
            key={key.id}
            inset={false}
            wrapSubtitle
            leading={
              <InsetIcon tone={expired ? 'neutral' : 'accent'}>
                <Key />
              </InsetIcon>
            }
            title={
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="truncate">{key.name}</span>
                {expired ? (
                  <Tag tone="warning" data-testid="connect-ai-key-expired">
                    {m.connect_ai_key_expired()}
                  </Tag>
                ) : null}
                {key.allowGoLive ? (
                  <Tag tone="accent">{m.connect_ai_key_can_go_live()}</Tag>
                ) : null}
              </span>
            }
            subtitle={
              <RowMeta
                items={subtitleParts}
                title={absoluteTimeLabel(key.createdAt)}
              />
            }
            trailing={
              <ConfirmDialog
                title={m.connect_ai_key_revoke_title()}
                description={m.connect_ai_key_revoke_description()}
                confirmLabel={m.connect_ai_key_revoke_confirm()}
                variant="destructive"
                testId="connect-ai-revoke-dialog"
                onConfirm={async () => {
                  try {
                    await onRevoke(key.id)
                    toast.success(m.connect_ai_key_revoked())
                  } catch (error) {
                    toast.error(errorMessage(error))
                  }
                }}
              >
                <RowActionButton
                  label={`${m.connect_ai_key_revoke()}: ${key.name}`}
                  text={m.connect_ai_key_revoke()}
                  data-testid="connect-ai-revoke"
                />
              </ConfirmDialog>
            }
          />
        )
      })}
    </InsetList>
  )
}

export function KeysListSkeleton() {
  return (
    <div
      className="grid gap-2"
      aria-hidden="true"
      data-testid="connect-ai-keys-loading"
    >
      <Skeleton className="h-14 rounded-card" />
      <Skeleton className="h-14 rounded-card" />
    </div>
  )
}
