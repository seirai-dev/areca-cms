import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, CloudArrowUp, Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { adminQueryKeys, errorMessage } from '#/components/admin/helpers'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { FormField } from '#/components/ui/form-field'
import { InsetList, InsetRow } from '#/components/ui/inset-list'
import { Input } from '#/components/ui/input'
import { QueryError } from '#/components/ui/query-error'
import { SettingsSection } from '#/components/ui/settings-section'
import { Skeleton } from '#/components/ui/skeleton'
import { StatusPill } from '#/components/ui/status-pill'
import { Hint } from '#/components/ui/tooltip'
import { m } from '#/paraglide/messages'
import {
  removeDokployCredentialsFn,
  saveDokployCredentialsFn,
  verifyDokployCredentialsFn,
} from '#/server/fn/admin'

import { dokployStatusQuery } from './queries'

type Applications = Awaited<ReturnType<typeof verifyDokployCredentialsFn>>

/**
 * The client's Dokploy connection: status, save & verify, verify, remove,
 * and the applications the credentials can see. Toasts as before; the last
 * failure also stays inline so the admin can read it.
 */
export function useDokploy(organizationId: string) {
  const queryClient = useQueryClient()
  const status = useQuery(dokployStatusQuery(organizationId))
  const [applications, setApplications] = React.useState<
    Applications | undefined
  >()
  const [failure, setFailure] = React.useState<string | null>(null)
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: adminQueryKeys.dokployCredentials(organizationId),
    })

  const save = useMutation({
    mutationFn: (input: { url: string; apiKey?: string }) =>
      saveDokployCredentialsFn({ data: { organizationId, ...input } }),
    onMutate: () => setFailure(null),
    onSuccess: async (result) => {
      toast.success(m.admin_org_dokploy_saved())
      setApplications({
        applications: result.applications,
        total: result.total,
      })
      await refresh()
    },
    onError: (err) => {
      setFailure(errorMessage(err))
      toast.error(errorMessage(err))
    },
  })

  const verify = useMutation({
    mutationFn: () => verifyDokployCredentialsFn({ data: { organizationId } }),
    onMutate: () => setFailure(null),
    onSuccess: (result) => {
      toast.success(m.admin_org_dokploy_verified())
      setApplications(result)
    },
    onError: (err) => {
      setFailure(errorMessage(err))
      toast.error(errorMessage(err))
    },
  })

  const remove = useMutation({
    mutationFn: () => removeDokployCredentialsFn({ data: { organizationId } }),
    onSuccess: async () => {
      toast.success(m.admin_org_dokploy_removed())
      setApplications(undefined)
      setFailure(null)
      await refresh()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return { status, applications, failure, save, verify, remove }
}

/** Client › Deployment (brief §3.11). */
export function ClientDeployment({
  organizationId,
}: {
  organizationId: string
}) {
  const { status, applications, failure, save, verify, remove } =
    useDokploy(organizationId)
  const [url, setUrl] = React.useState('')
  const [apiKey, setApiKey] = React.useState('')
  const configured = Boolean(status.data?.configured)

  // Seed the address from the stored credentials; the key is never shown.
  React.useEffect(() => {
    if (status.data) {
      setUrl(status.data.url ?? '')
      setApiKey('')
    }
  }, [status.data])

  const busy = save.isPending || verify.isPending || remove.isPending

  return (
    <div className="grid">
      <SettingsSection
        title={m.agency_dokploy_title()}
        description={m.agency_dokploy_description()}
      >
        {status.isError ? (
          <QueryError
            title={m.agency_dokploy_load_error()}
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
          <form
            className="grid gap-5"
            data-testid="dokploy-form"
            onSubmit={(event) => {
              event.preventDefault()
              save.mutate({
                url: url.trim(),
                apiKey: apiKey.trim() || undefined,
              })
            }}
          >
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-content-center rounded-[11px] bg-background-subtle text-icon-default">
                <CloudArrowUp className="size-5" />
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-headline text-text-primary">
                  {m.agency_dokploy_title()}
                </span>
                <span className="truncate text-caption font-normal text-text-muted">
                  {configured && status.data.url
                    ? status.data.url
                    : m.agency_dokploy_not_set_up_body()}
                </span>
              </div>
              {configured ? (
                <StatusPill
                  tone="success"
                  icon="check"
                  label={m.agency_dokploy_connected()}
                  data-testid="dokploy-status"
                  status="configured"
                />
              ) : (
                <StatusPill
                  tone="neutral"
                  label={m.admin_org_dokploy_not_configured()}
                  data-testid="dokploy-status"
                  status="not-configured"
                />
              )}
            </div>

            <FormField label={m.admin_org_dokploy_url()} htmlFor="dokploy-url">
              <Input
                id="dokploy-url"
                data-testid="dokploy-url"
                type="url"
                required
                placeholder="https://dokploy.example.com"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </FormField>
            <FormField
              label={m.admin_org_dokploy_api_key()}
              htmlFor="dokploy-api-key"
              hint={
                configured
                  ? m.admin_org_dokploy_api_key_replace_hint()
                  : m.admin_org_dokploy_api_key_new_hint()
              }
            >
              <Input
                id="dokploy-api-key"
                data-testid="dokploy-api-key"
                type="password"
                required={!configured}
                autoComplete="new-password"
                placeholder={configured ? '••••••••••••' : undefined}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </FormField>

            {failure ? (
              <p
                role="alert"
                data-testid="dokploy-error"
                className="rounded-control bg-status-error-bg px-3 py-2.5 text-callout text-text-error"
              >
                {m.agency_dokploy_failed({ message: failure })}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                data-testid="save-dokploy-credentials"
                loading={save.isPending}
                disabled={busy && !save.isPending}
              >
                {m.agency_dokploy_save()}
              </Button>
              <Hint
                label={configured ? '' : m.agency_dokploy_verify_reason()}
                wrapDisabled={!configured}
              >
                <Button
                  type="button"
                  variant="secondary"
                  data-testid="verify-dokploy-credentials"
                  disabled={!configured || (busy && !verify.isPending)}
                  loading={verify.isPending}
                  onClick={() => verify.mutate()}
                >
                  {verify.isPending ? null : <CheckCircle />}
                  {verify.isPending
                    ? m.admin_org_dokploy_verifying()
                    : m.admin_org_dokploy_verify()}
                </Button>
              </Hint>
              {configured ? (
                <ConfirmDialog
                  title={m.admin_org_dokploy_remove_title()}
                  description={m.admin_org_dokploy_remove_description()}
                  confirmLabel={m.admin_org_dokploy_remove()}
                  variant="destructive"
                  onConfirm={async () => {
                    await remove.mutateAsync()
                  }}
                >
                  <Button
                    type="button"
                    variant="quiet"
                    className="ml-auto text-text-error hover:text-text-error"
                    data-testid="remove-dokploy-credentials"
                    disabled={busy}
                  >
                    <Trash />
                    {m.agency_dokploy_remove()}
                  </Button>
                </ConfirmDialog>
              ) : null}
            </div>
          </form>
        )}
      </SettingsSection>

      {applications ? (
        <SettingsSection
          title={m.agency_dokploy_apps_title()}
          description={m.agency_dokploy_apps_description()}
          bare
        >
          <div className="grid gap-2" data-testid="dokploy-applications">
            <p className="px-1 text-callout text-text-secondary tnum">
              {m.admin_org_dokploy_applications({ count: applications.total })}
            </p>
            {applications.applications.length === 0 ? (
              <p className="rounded-card border border-dashed border-border-strong px-4 py-6 text-center text-callout text-text-secondary">
                {m.admin_org_dokploy_no_applications()}
              </p>
            ) : (
              <InsetList>
                {applications.applications.map((application) => (
                  <InsetRow
                    key={application.applicationId}
                    title={application.name}
                    subtitle={
                      <span className="font-mono text-[12px]">
                        {application.appName ?? application.applicationId}
                      </span>
                    }
                    trailing={
                      application.applicationStatus ? (
                        <StatusPill
                          size="sm"
                          tone={
                            application.applicationStatus === 'done'
                              ? 'success'
                              : application.applicationStatus === 'error'
                                ? 'error'
                                : 'neutral'
                          }
                          label={application.applicationStatus}
                        />
                      ) : null
                    }
                  />
                ))}
              </InsetList>
            )}
            {applications.total > applications.applications.length ? (
              <p className="px-1 text-caption font-normal text-text-muted">
                {m.admin_org_dokploy_applications_truncated({
                  shown: applications.applications.length,
                  total: applications.total,
                })}
              </p>
            ) : null}
          </div>
        </SettingsSection>
      ) : null}
    </div>
  )
}
