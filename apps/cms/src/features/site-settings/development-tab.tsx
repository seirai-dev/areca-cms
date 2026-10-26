import * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowSquareOut,
  ArrowsClockwise,
  Plus,
  Trash,
} from '@phosphor-icons/react'
import { toast } from 'sonner'

import { errorMessage } from '#/lib/admin/helpers'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { CopyButton } from '#/components/ui/copy-button'
import { InsetList, InsetRow } from '#/components/ui/inset-list'
import { QueryError } from '#/components/ui/query-error'
import { SettingsSection } from '#/components/ui/settings-section'
import { Skeleton } from '#/components/ui/skeleton'
import { absoluteTimeLabel, formatRelativeTime } from '#/lib/relative-time'
import { m } from '#/paraglide/messages'

import { TokenReveal } from './token-reveal'
import type { SiteRecord } from './use-site-settings'
import { useDevEnvironment } from './use-dev-environment'
import { resetDevEnvDescription } from '#/features/dev-env/reset-copy'

type DevEnvStatus = NonNullable<
  ReturnType<typeof useDevEnvironment>['status']['data']
>
type HistoryRow = DevEnvStatus['history'][number]
type CreatedDevEnv = Awaited<
  ReturnType<ReturnType<typeof useDevEnvironment>['createEnv']['mutateAsync']>
>

/** The production site's development environment: create, open, reset, delete. */
export function DevelopmentTab({ site }: { site: SiteRecord }) {
  const dev = useDevEnvironment(site.id, true)
  const [created, setCreated] = React.useState<CreatedDevEnv | null>(null)

  if (dev.status.isError) {
    return (
      <QueryError
        error={dev.status.error}
        onRetry={() => void dev.status.refetch()}
        retrying={dev.status.isFetching}
      />
    )
  }
  if (dev.status.isPending) {
    return <Skeleton className="h-48 rounded-card" />
  }

  const status = dev.status.data
  const label = status ? status.name : site.name

  return (
    <div data-testid="settings-development" className="grid gap-8">
      {created ? (
        <CreatedTokens created={created} onDismiss={() => setCreated(null)} />
      ) : null}

      <SettingsSection
        title={m.dev_env_tab_title()}
        description={m.dev_env_tab_description()}
      >
        {status ? (
          <div className="grid gap-4">
            <InsetList>
              <InsetRow
                title={m.dev_env_site_key()}
                trailing={
                  <span className="font-mono text-[13px] text-text-primary">
                    {status.slug}
                  </span>
                }
              />
              <InsetRow
                title={m.dev_env_last_reset()}
                trailing={formatRelativeTime(status.lastForkedAt)}
              />
              <InsetRow
                title={m.dev_env_last_push()}
                trailing={
                  status.lastPushedAt
                    ? formatRelativeTime(status.lastPushedAt)
                    : m.dev_env_never()
                }
              />
            </InsetList>

            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="md">
                <Link
                  to="/sites/$siteId"
                  params={{ siteId: status.id }}
                  data-testid="dev-env-open"
                >
                  <ArrowSquareOut />
                  {m.dev_env_open()}
                </Link>
              </Button>
              <ConfirmDialog
                title={m.dev_env_reset_title()}
                description={resetDevEnvDescription(status.unpushedChanges)}
                confirmLabel={m.dev_env_reset_confirm()}
                variant="destructive"
                testId="dev-env-reset-dialog"
                onConfirm={async () => {
                  try {
                    await dev.reset.mutateAsync(status.id)
                    toast.success(m.dev_env_reset_done())
                  } catch (error) {
                    toast.error(errorMessage(error))
                  }
                }}
              >
                <Button
                  type="button"
                  variant="quiet"
                  size="md"
                  loading={dev.reset.isPending}
                  data-testid="dev-env-reset"
                >
                  {dev.reset.isPending ? null : <ArrowsClockwise />}
                  {m.dev_env_reset()}
                </Button>
              </ConfirmDialog>
              <ConfirmDialog
                title={m.dev_env_delete_title()}
                description={m.dev_env_delete_description()}
                confirmLabel={m.dev_env_delete_confirm()}
                variant="destructive"
                testId="dev-env-delete-dialog"
                onConfirm={async () => {
                  try {
                    await dev.remove.mutateAsync(status.id)
                    toast.success(m.dev_env_deleted())
                  } catch (error) {
                    toast.error(errorMessage(error))
                  }
                }}
              >
                <Button
                  type="button"
                  variant="quiet"
                  size="md"
                  loading={dev.remove.isPending}
                  className="text-text-error hover:bg-status-error-bg hover:text-text-error"
                  data-testid="dev-env-delete"
                >
                  {dev.remove.isPending ? null : <Trash />}
                  {m.dev_env_delete()}
                </Button>
              </ConfirmDialog>
            </div>
          </div>
        ) : (
          <div className="grid max-w-[52ch] gap-4">
            <p className="text-callout text-text-secondary">
              {m.dev_env_none_body()}
            </p>
            <div>
              <Button
                type="button"
                variant="outline"
                size="md"
                loading={dev.createEnv.isPending}
                data-testid="dev-env-create"
                onClick={async () => {
                  try {
                    const result = await dev.createEnv.mutateAsync()
                    setCreated(result)
                    toast.success(m.dev_env_created())
                  } catch (error) {
                    toast.error(errorMessage(error))
                  }
                }}
              >
                {dev.createEnv.isPending ? null : <Plus />}
                {m.dev_env_create()}
              </Button>
            </div>
          </div>
        )}
      </SettingsSection>

      {status ? (
        <SettingsSection
          title={m.dev_env_history_title()}
          description={label}
          bare
        >
          <PushHistory history={status.history} />
        </SettingsSection>
      ) : null}
    </div>
  )
}

/**
 * The tokens of a freshly created dev env, shown once. The site token and the
 * schema token each get the usual reveal with an env snippet; the preview
 * secret has no other place in the UI, so it gets a plain copy row.
 */
function CreatedTokens({
  created,
  onDismiss,
}: {
  created: CreatedDevEnv
  onDismiss: () => void
}) {
  return (
    <div className="grid gap-4" data-testid="dev-env-created">
      <TokenReveal token={created.token} />
      <TokenReveal token={created.schemaToken} privilege="schema" />
      <div className="grid gap-1.5">
        <span className="px-0.5 text-caption text-text-muted">
          {m.dev_env_preview_secret()}
        </span>
        <div className="flex items-center gap-2 rounded-control border border-border-default bg-background-surface py-1.5 pr-1.5 pl-3">
          <code
            data-testid="dev-env-preview-secret"
            className="min-w-0 flex-1 bg-transparent p-0 text-mono break-all text-text-primary select-all"
          >
            {created.previewSecret}
          </code>
          <CopyButton
            value={created.previewSecret}
            label={m.dev_env_copy_preview_secret()}
            copiedLabel={m.admin_token_copied_label()}
            toastMessage={m.admin_token_copied()}
            variant="secondary"
            size="xs"
            aria-label={m.dev_env_copy_preview_secret()}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="secondary" size="md">
          <Link to="/sites/$siteId" params={{ siteId: created.id }}>
            <ArrowSquareOut />
            {m.dev_env_open()}
          </Link>
        </Button>
        <Button
          type="button"
          variant="quiet"
          size="md"
          onClick={onDismiss}
          data-testid="dev-env-tokens-done"
        >
          {m.dev_env_tokens_done()}
        </Button>
      </div>
    </div>
  )
}

function PushHistory({ history }: { history: HistoryRow[] }) {
  if (history.length === 0) {
    return (
      <p className="px-0.5 text-callout text-text-secondary">
        {m.dev_env_history_empty()}
      </p>
    )
  }
  return (
    <InsetList data-testid="dev-env-history">
      {history.map((row) => (
        <InsetRow
          key={row.id}
          title={kindLabel(row.kind)}
          subtitle={historySummary(row.kind, row.counts)}
          wrapSubtitle
          trailing={
            <span
              className="grid justify-items-end gap-0.5 text-right"
              title={absoluteTimeLabel(row.createdAt)}
            >
              <span className="text-text-secondary">
                {formatRelativeTime(row.createdAt)}
              </span>
              <span className="text-caption text-text-muted">
                {row.actorName
                  ? m.dev_env_history_by({ name: row.actorName })
                  : m.dev_env_history_removed_user()}
              </span>
            </span>
          }
        />
      ))}
    </InsetList>
  )
}

function kindLabel(kind: string) {
  switch (kind) {
    case 'fork':
      return m.dev_env_kind_fork()
    case 'refresh':
      return m.dev_env_kind_refresh()
    case 'push':
      return m.dev_env_kind_push()
    case 'copy':
      return m.dev_env_kind_copy()
    default:
      return kind
  }
}

/** "Collections 2 · Sections 1 · Entries 14", read from the stored counts. */
function historySummary(kind: string, counts: Record<string, number>) {
  const n = (key: string) => counts[key] ?? 0
  if (kind === 'fork' || kind === 'refresh') {
    return m.dev_env_history_counts_fork({
      collections: n('collections'),
      sections: n('sections'),
      entries: n('entries'),
    })
  }
  if (kind === 'push') {
    return m.dev_env_history_counts_push({
      schema: n('schema'),
      added: n('new'),
      changed: n('changed'),
      archived: n('archived'),
      skipped: n('skipped'),
    })
  }
  return null
}
