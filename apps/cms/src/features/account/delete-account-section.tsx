import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { SettingsSection } from '#/components/ui/settings-section'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'

import { DeleteAccountDialog } from './delete-account-dialog'
import { deleteProofFor } from './account-logic'

export type MyAccountDeletion = {
  /** Clients where this person is the only owner. */
  soleOwnerOf: Array<{ organizationId: string; name: string }>
  /** This person is the last active agency admin. */
  lastAdmin: boolean
}

/**
 * The danger zone, last on the account page. Deleting is refused while the
 * person is the only owner of a client or the last active agency admin: the
 * section names those clients and links to their People pages, and the button
 * stays visible but disabled (§8.4).
 */
export function DeleteAccountSection({
  me,
  hasPassword,
  deletion,
}: {
  me: Me
  hasPassword: boolean
  deletion: MyAccountDeletion
}) {
  const [open, setOpen] = React.useState(false)
  const blocked = deletion.soleOwnerOf.length > 0 || deletion.lastAdmin
  const proof = deleteProofFor({
    hasPassword,
    twoFactorEnabled: me.user.twoFactorEnabled,
  })

  return (
    <SettingsSection
      id="danger-zone"
      danger
      title={m.account_danger_title()}
      description={m.account_danger_description()}
    >
      {blocked ? (
        <div className="grid gap-4" data-testid="delete-account-blockers">
          {deletion.soleOwnerOf.length > 0 ? (
            <div className="grid gap-3">
              <p className="text-headline text-text-primary">
                {deletion.soleOwnerOf.length === 1
                  ? m.account_delete_owner_title_one()
                  : m.account_delete_owner_title_other()}
              </p>
              <p className="text-callout text-text-secondary">
                {m.account_delete_owner_help()}
              </p>
              <ul className="grid gap-2.5">
                {deletion.soleOwnerOf.map((client) => (
                  <li
                    key={client.organizationId}
                    data-testid={`delete-blocker-client-${client.organizationId}`}
                    className="min-w-0"
                  >
                    <ClientLink me={me} client={client} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {deletion.lastAdmin ? (
            <div className="grid gap-2">
              <p className="text-callout text-text-secondary">
                {m.account_delete_reason_admin()}
              </p>
              <Link
                to="/agency/people"
                data-testid="delete-blocker-people"
                className="justify-self-start text-callout font-medium text-text-accent underline-offset-4 hover:underline"
              >
                {m.account_delete_people_link()}
              </Link>
            </div>
          ) : null}
          <div>
            <Button
              type="button"
              variant="outline"
              disabled
              data-testid="delete-account"
              className="w-full sm:w-auto"
            >
              {m.account_delete_button()}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            type="button"
            variant="outline"
            data-testid="delete-account"
            className="w-full text-text-error sm:w-auto"
            onClick={() => setOpen(true)}
          >
            {m.account_delete_button()}
          </Button>
        </div>
      )}
      {blocked ? null : (
        <DeleteAccountDialog
          email={me.user.email}
          proof={proof}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </SettingsSection>
  )
}

/**
 * A client named as a link to its People page: the client name, an arrow, and
 * a link colour that underlines on hover. Admins have the client page in the
 * Agency workspace; owners go to People in one of the client's sites (the same
 * rule as the legacy `/orgs/$orgId/members` redirect). A client with no site
 * has no People page to link to, so it is named as plain text.
 */
function ClientLink({
  me,
  client,
}: {
  me: Me
  client: { organizationId: string; name: string }
}) {
  const className =
    'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[4px] text-body font-medium text-text-accent underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus'
  const label = (
    <>
      <span className="min-w-0 truncate">{client.name}</span>
      <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
    </>
  )
  const testId = `delete-blocker-people-${client.organizationId}`
  if (me.user.isAgencyAdmin) {
    return (
      <Link
        to="/agency/clients/$orgId"
        params={{ orgId: client.organizationId }}
        search={{ tab: 'people' }}
        data-testid={testId}
        className={className}
      >
        {label}
      </Link>
    )
  }
  const site = me.sites.find(
    (item) => item.organizationId === client.organizationId,
  )
  if (!site) {
    return (
      <span className="min-w-0 truncate text-body text-text-primary">
        {client.name}
      </span>
    )
  }
  return (
    <Link
      to="/sites/$siteId/people"
      params={{ siteId: site.id }}
      data-testid={testId}
      className={className}
    >
      {label}
    </Link>
  )
}
