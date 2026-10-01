import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { adminQueryKeys, errorMessage } from '#/lib/admin/helpers'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { SettingsSection } from '#/components/ui/settings-section'
import { Hint } from '#/components/ui/tooltip'
import { useStepUp } from '#/features/security/step-up'
import { m } from '#/paraglide/messages'
import { deleteOrganizationFn, updateOrganizationFn } from '#/server/fn/admin'

import type { ClientRow } from './queries'

/** Rename and delete a client. */
function useClientSettings(client: ClientRow) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const navigate = useNavigate()
  const stepUp = useStepUp()

  const rename = useMutation({
    mutationFn: (name: string) =>
      updateOrganizationFn({ data: { id: client.id, name } }),
    onSuccess: async () => {
      toast.success(m.admin_org_toast_renamed())
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminQueryKeys.organizations,
        }),
        queryClient.invalidateQueries({ queryKey: ['sites-overview'] }),
        router.invalidate(),
      ])
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: () =>
      stepUp.run(() => deleteOrganizationFn({ data: { id: client.id } })),
    onSuccess: async () => {
      toast.success(m.agency_client_deleted())
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.organizations,
      })
      await navigate({ to: '/agency/clients' })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return { rename, remove }
}

/**
 * Client › Settings (brief §3.11): rename ("Save name"), and the danger zone
 * to delete the client, blocked while it still has sites (with a link to the
 * Sites tab), type-to-confirm with the short name.
 */
export function ClientSettings({
  client,
  onShowSites,
}: {
  client: ClientRow
  onShowSites: () => void
}) {
  const { rename, remove } = useClientSettings(client)
  const [name, setName] = React.useState(client.name)
  React.useEffect(() => setName(client.name), [client.name])
  const dirty = name.trim().length > 0 && name.trim() !== client.name
  const hasSites = client.siteCount > 0

  return (
    <div className="grid">
      <SettingsSection
        title={m.admin_org_general()}
        description={m.agency_client_general_description()}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (dirty) rename.mutate(name.trim())
          }}
        >
          <FormField label={m.agency_client_name()} htmlFor="rename-org">
            <Input
              id="rename-org"
              data-testid="rename-org"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <div className="grid gap-1">
            <span className="text-[13px] leading-5 font-medium text-text-primary">
              {m.agency_slug_label()}
            </span>
            <span className="w-fit rounded-[6px] bg-background-subtle px-2 py-1 font-mono text-[12.5px] text-text-secondary">
              {client.slug}
            </span>
            <span className="text-caption font-normal text-text-muted">
              {m.agency_slug_locked()}
            </span>
          </div>
          <div className="flex justify-end">
            <Button
              type="submit"
              data-testid="save-org-name"
              disabled={!dirty}
              loading={rename.isPending}
            >
              {m.admin_org_save_name()}
            </Button>
          </div>
        </form>
      </SettingsSection>

      <SettingsSection
        title={m.admin_org_danger_zone()}
        description={m.agency_client_danger_description()}
        danger
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <p className="text-[14px] leading-5 font-medium text-text-primary">
              {m.agency_delete_client_title()}
            </p>
            {hasSites ? (
              <p
                className="text-callout text-text-secondary"
                data-testid="delete-org-blocked"
              >
                {client.siteCount === 1
                  ? m.agency_delete_blocked_one()
                  : m.agency_delete_blocked_other({
                      count: client.siteCount,
                    })}{' '}
                <button
                  type="button"
                  onClick={onShowSites}
                  className="font-medium text-text-accent underline-offset-4 hover:underline"
                >
                  {m.agency_go_to_sites()}
                </button>
              </p>
            ) : (
              <p className="text-callout text-text-secondary">
                {m.admin_org_delete_description()}
              </p>
            )}
          </div>
          {hasSites ? (
            <Hint label={m.agency_delete_blocked_reason()} wrapDisabled>
              <Button
                type="button"
                variant="outline"
                className="text-text-error hover:bg-status-error-bg hover:text-text-error"
                data-testid="delete-org"
                disabled
              >
                {m.agency_delete_client()}
              </Button>
            </Hint>
          ) : (
            <ConfirmDialog
              title={m.admin_org_delete_title({ name: client.name })}
              description={m.admin_org_delete_description()}
              confirmLabel={m.agency_delete_client()}
              variant="destructive"
              confirmText={client.slug}
              onConfirm={async () => {
                await remove.mutateAsync()
              }}
            >
              <Button
                type="button"
                variant="outline"
                className="text-text-error hover:bg-status-error-bg hover:text-text-error"
                data-testid="delete-org"
                loading={remove.isPending}
              >
                {m.agency_delete_client()}
              </Button>
            </ConfirmDialog>
          )}
        </div>
      </SettingsSection>
    </div>
  )
}
