import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Cloud,
  Minus,
  Trash,
  X,
  CheckCircle,
} from '@phosphor-icons/react'
import { toast } from 'sonner'

import type {
  CloudflareCheck,
  CloudflarePermissionChecks,
  CloudflareTokenCheck,
} from '#/adapters/deployment/cloudflare-api'
import { cloudflareChecksPassed } from '#/adapters/deployment/cloudflare-api'
import { useStepUp } from '#/features/security/step-up'
import { adminQueryKeys, errorMessage } from '#/lib/admin/helpers'
import { formatRelativeTime } from '#/lib/relative-time'
import { cn } from '#/lib/utils'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { QueryError } from '#/components/ui/query-error'
import { SettingsSection } from '#/components/ui/settings-section'
import { Skeleton } from '#/components/ui/skeleton'
import { StatusPill } from '#/components/ui/status-pill'
import { Hint } from '#/components/ui/tooltip'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import {
  removeCloudflareCredentialsFn,
  saveCloudflareCredentialsFn,
  verifyCloudflareCredentialsFn,
} from '#/server/fn/admin'

import { CloudflareSetupGuide } from './cloudflare-setup-guide'
import { cloudflareStatusQuery } from './queries'

type CheckState = 'pass' | 'fail' | 'skipped'

function checkState(check: CloudflareCheck): CheckState {
  if (check.ok) return 'pass'
  return check.skipped ? 'skipped' : 'fail'
}

function tokenDetail(token: CloudflareTokenCheck) {
  switch (token.status) {
    case 'active':
      return token.expiresOn
        ? `${m.agency_cloudflare_token_active()} ${m.agency_cloudflare_token_expires({ date: formatDate(token.expiresOn) })}`
        : m.agency_cloudflare_token_active()
    case 'disabled':
      return m.agency_cloudflare_token_disabled()
    case 'expired':
      return m.agency_cloudflare_token_expired()
    case 'invalid':
      return m.agency_cloudflare_token_invalid()
    default:
      return m.agency_cloudflare_token_unknown()
  }
}

function skippedDetail(check: CloudflareCheck) {
  switch (check.skipped) {
    case 'no-workers':
      return m.agency_cloudflare_skipped_no_workers()
    case 'workers-unavailable':
      return m.agency_cloudflare_skipped_workers_unavailable()
    default:
      return m.agency_cloudflare_skipped_token()
  }
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

/** One row per permission: pass, fail or skipped, with the reason. */
function CloudflareChecks({ checks }: { checks: CloudflarePermissionChecks }) {
  const rows: {
    key: string
    name: string
    state: CheckState
    detail: string | undefined
  }[] = [
    {
      key: 'token',
      name: m.agency_cloudflare_check_token(),
      state: checks.token.ok ? 'pass' : 'fail',
      detail: tokenDetail(checks.token),
    },
    {
      key: 'pages',
      name: m.agency_cloudflare_check_pages(),
      state: checkState(checks.pages),
      detail: checkDetail(checks.pages),
    },
    {
      key: 'workers-scripts',
      name: m.agency_cloudflare_check_workers_scripts(),
      state: checkState(checks.workersScripts),
      detail: checkDetail(checks.workersScripts),
    },
    {
      key: 'workers-ci',
      name: m.agency_cloudflare_check_workers_ci(),
      state: checkState(checks.workersCi),
      detail: checkDetail(checks.workersCi),
    },
  ]

  return (
    <div className="grid gap-2">
      <p className="px-1 text-caption font-medium text-text-muted">
        {m.agency_cloudflare_checks_title()}
      </p>
      <ul
        data-testid="cloudflare-checks"
        className="divide-y divide-border-default border-y border-border-default"
        aria-label={m.agency_cloudflare_checks_title()}
      >
        {rows.map((row) => (
          <li
            key={row.key}
            data-testid={`cloudflare-check-${row.key}`}
            data-state={row.state}
            className="flex items-start gap-3 px-1 py-2.5"
          >
            <span
              aria-hidden="true"
              className="mt-0.5 grid size-5 shrink-0 place-content-center"
            >
              {row.state === 'pass' ? (
                <Check weight="bold" className="size-4 text-icon-success" />
              ) : row.state === 'fail' ? (
                <X weight="bold" className="size-4 text-text-error" />
              ) : (
                <Minus weight="bold" className="size-4 text-icon-muted" />
              )}
            </span>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-callout text-text-primary">{row.name}</span>
              {row.detail ? (
                <span className="text-caption font-normal break-words text-text-muted">
                  {row.detail}
                </span>
              ) : null}
            </div>
            <StatusPill
              size="sm"
              tone={
                row.state === 'pass'
                  ? 'success'
                  : row.state === 'fail'
                    ? 'error'
                    : 'neutral'
              }
              label={
                row.state === 'pass'
                  ? m.agency_cloudflare_check_passed()
                  : row.state === 'fail'
                    ? m.agency_cloudflare_check_failed()
                    : m.agency_cloudflare_check_skipped()
              }
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Success toast, unless a permission check failed (the list shows which). */
function notifyChecks(checks: CloudflarePermissionChecks, done: string) {
  if (cloudflareChecksPassed(checks)) toast.success(done)
  else toast.warning(m.agency_cloudflare_checks_need_attention())
}

function checkDetail(check: CloudflareCheck) {
  if (check.skipped) return skippedDetail(check)
  if (!check.ok) return check.message
  return check.count === undefined
    ? undefined
    : m.agency_cloudflare_check_count({ count: check.count })
}

/**
 * The client's Cloudflare connection: account ID, write-only API token,
 * save and verify, remove, and the permission checks. The token never leaves
 * the server; the form only ever shows its last four characters.
 */
export function CloudflareCard({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient()
  const stepUp = useStepUp()
  const status = useQuery(cloudflareStatusQuery(organizationId))
  const [guideOpen, setGuideOpen] = React.useState(false)
  const [accountId, setAccountId] = React.useState('')
  const [apiToken, setApiToken] = React.useState('')
  const [failure, setFailure] = React.useState<string | null>(null)

  const configured = Boolean(status.data?.configured)
  const encryptionAvailable = Boolean(status.data?.encryptionAvailable)
  const last4 = status.data?.tokenLast4 ?? null
  const checks = status.data?.lastVerifyResult ?? null
  const sitesUsingCloudflare = status.data?.sitesUsingCloudflare ?? 0

  // Seed the account ID from the stored connection; the token is never shown.
  React.useEffect(() => {
    if (status.data) {
      setAccountId(status.data.accountId ?? '')
      setApiToken('')
    }
  }, [status.data])

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: adminQueryKeys.cloudflareCredentials(organizationId),
    })

  const save = useMutation({
    mutationFn: (input: { accountId: string; apiToken?: string }) =>
      stepUp.run(() =>
        saveCloudflareCredentialsFn({ data: { organizationId, ...input } }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: async (result) => {
      notifyChecks(result.checks, m.agency_cloudflare_saved())
      await refresh()
    },
    onError: (err) => {
      setFailure(errorMessage(err))
      toast.error(errorMessage(err))
    },
  })

  const verify = useMutation({
    mutationFn: () =>
      verifyCloudflareCredentialsFn({ data: { organizationId } }),
    onMutate: () => setFailure(null),
    onSuccess: async (result) => {
      notifyChecks(result.checks, m.agency_cloudflare_verified())
      await refresh()
    },
    onError: (err) => {
      setFailure(errorMessage(err))
      toast.error(errorMessage(err))
    },
  })

  const remove = useMutation({
    mutationFn: () =>
      stepUp.run(() =>
        removeCloudflareCredentialsFn({ data: { organizationId } }),
      ),
    onSuccess: async () => {
      toast.success(m.agency_cloudflare_removed())
      setFailure(null)
      await refresh()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const busy = save.isPending || verify.isPending || remove.isPending

  const removeDescription = (
    <span className="grid gap-2">
      <span>{m.agency_cloudflare_remove_description()}</span>
      {sitesUsingCloudflare > 0 ? (
        <span
          data-testid="cloudflare-remove-sites"
          className="font-medium text-text-primary"
        >
          {m.agency_cloudflare_remove_sites({ count: sitesUsingCloudflare })}
        </span>
      ) : null}
    </span>
  )

  return (
    <div data-testid="cloudflare-card">
      <SettingsSection
        title={m.agency_cloudflare_title()}
        description={m.agency_cloudflare_description()}
      >
        {status.isError ? (
          <QueryError
            title={m.agency_cloudflare_load_error()}
            error={status.error}
            onRetry={() => void status.refetch()}
            retrying={status.isFetching}
          />
        ) : status.isPending ? (
          <div className="grid gap-4" aria-busy="true">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <div className="grid gap-5">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-content-center rounded-[11px] bg-background-subtle text-icon-default">
                <Cloud className="size-5" />
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-headline text-text-primary">
                  {m.agency_cloudflare_title()}
                </span>
                <span
                  className={cn(
                    'truncate text-caption font-normal text-text-muted',
                    configured && status.data.accountId && 'font-mono',
                  )}
                >
                  {configured && status.data.accountId
                    ? `${status.data.accountId}${last4 ? ` · •••• ${last4}` : ''}`
                    : m.agency_cloudflare_not_set_up_body()}
                </span>
              </div>
              {configured ? (
                <StatusPill
                  tone="success"
                  icon="check"
                  label={m.agency_cloudflare_connected()}
                  data-testid="cloudflare-status"
                  status="configured"
                />
              ) : (
                <StatusPill
                  tone="neutral"
                  label={m.agency_cloudflare_not_connected()}
                  data-testid="cloudflare-status"
                  status="not-configured"
                />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="cloudflare-guide-open"
                onClick={() => setGuideOpen(true)}
              >
                {m.agency_cloudflare_guide_open()}
              </Button>
            </div>

            {status.data.encryptionAvailable ? null : (
              <div
                role="status"
                data-testid="cloudflare-encryption-missing"
                className="grid gap-1 rounded-control bg-status-warning-bg px-3 py-2.5"
              >
                <span className="text-callout font-medium text-text-primary">
                  {m.agency_cloudflare_encryption_missing_title()}
                </span>
                <span className="text-callout text-text-secondary">
                  {m.agency_cloudflare_encryption_missing_body()}
                </span>
              </div>
            )}

            <form
              className="grid gap-5"
              data-testid="cloudflare-form"
              onSubmit={(event) => {
                event.preventDefault()
                save.mutate({
                  accountId: accountId.trim(),
                  apiToken: apiToken.trim() || undefined,
                })
              }}
            >
              <FormField
                label={m.agency_cloudflare_account_id()}
                htmlFor="cloudflare-account-id"
                hint={m.agency_cloudflare_account_id_hint()}
              >
                <Input
                  id="cloudflare-account-id"
                  data-testid="cloudflare-account-id"
                  required
                  pattern="[0-9a-fA-F]{32}"
                  title={m.agency_cloudflare_account_id_invalid()}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  disabled={!encryptionAvailable}
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                />
              </FormField>
              <FormField
                label={m.agency_cloudflare_api_token()}
                htmlFor="cloudflare-api-token"
                hint={
                  configured
                    ? m.agency_cloudflare_api_token_replace_hint()
                    : m.agency_cloudflare_api_token_new_hint()
                }
              >
                <Input
                  id="cloudflare-api-token"
                  data-testid="cloudflare-api-token"
                  type="password"
                  required={!configured}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={
                    configured && last4 ? `•••• ${last4}` : undefined
                  }
                  disabled={!encryptionAvailable}
                  value={apiToken}
                  onChange={(event) => setApiToken(event.target.value)}
                />
              </FormField>

              {failure ? (
                <p
                  role="alert"
                  data-testid="cloudflare-error"
                  className="rounded-control bg-status-error-bg px-3 py-2.5 text-callout text-text-error"
                >
                  {m.agency_cloudflare_failed({ message: failure })}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  data-testid="cloudflare-save"
                  loading={save.isPending}
                  disabled={!encryptionAvailable || (busy && !save.isPending)}
                >
                  {m.agency_cloudflare_save()}
                </Button>
                <Hint
                  label={configured ? '' : m.agency_cloudflare_verify_reason()}
                  wrapDisabled={!configured}
                >
                  <Button
                    type="button"
                    variant="secondary"
                    data-testid="cloudflare-verify"
                    disabled={!configured || (busy && !verify.isPending)}
                    loading={verify.isPending}
                    onClick={() => verify.mutate()}
                  >
                    {verify.isPending ? null : <CheckCircle />}
                    {verify.isPending
                      ? m.agency_cloudflare_verifying()
                      : m.agency_cloudflare_verify()}
                  </Button>
                </Hint>
                {configured ? (
                  <ConfirmDialog
                    title={m.agency_cloudflare_remove_title()}
                    description={removeDescription}
                    confirmLabel={m.agency_cloudflare_remove()}
                    variant="destructive"
                    testId="cloudflare-remove-confirm"
                    onConfirm={async () => {
                      await remove.mutateAsync()
                    }}
                  >
                    <Button
                      type="button"
                      variant="quiet"
                      className="ml-auto text-text-error hover:text-text-error"
                      data-testid="cloudflare-remove"
                      disabled={busy}
                    >
                      <Trash />
                      {m.agency_cloudflare_remove()}
                    </Button>
                  </ConfirmDialog>
                ) : null}
              </div>
            </form>

            {configured ? (
              <div className="grid gap-4">
                {checks ? <CloudflareChecks checks={checks} /> : null}
                <div className="grid gap-0.5 px-1 text-caption font-normal text-text-muted">
                  <span data-testid="cloudflare-last-verified">
                    {status.data.lastVerifiedAt
                      ? m.agency_cloudflare_last_verified({
                          time: formatRelativeTime(status.data.lastVerifiedAt),
                        })
                      : m.agency_cloudflare_never_verified()}
                  </span>
                  {status.data.updatedByName && status.data.updatedAt ? (
                    <span data-testid="cloudflare-saved-by">
                      {m.agency_cloudflare_saved_by({
                        name: status.data.updatedByName,
                        date: formatDate(status.data.updatedAt),
                      })}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </SettingsSection>

      <CloudflareSetupGuide open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  )
}
