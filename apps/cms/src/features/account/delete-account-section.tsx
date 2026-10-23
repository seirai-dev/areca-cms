import * as React from 'react'
import { Link } from '@tanstack/react-router'

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
            <div className="grid gap-2">
              <p className="text-headline text-text-primary">
                {m.account_delete_owner_title()}
              </p>
              <ul className="divide-y divide-border-default overflow-hidden rounded-control border border-border-default">
                {deletion.soleOwnerOf.map((client) => (
                  <li
                    key={client.organizationId}
                    data-testid={`delete-blocker-client-${client.organizationId}`}
                    className="flex min-w-0 items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <span className="min-w-0 truncate text-body text-text-primary">
                      {client.name}
                    </span>
                    <PeopleLink
                      me={me}
                      organizationId={client.organizationId}
                    />
                  </li>
                ))}
              </ul>
              <p className="text-callout text-text-secondary">
                {m.account_delete_owner_help()}
              </p>
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
              className="w-full text-text-error sm:w-auto"
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
 * Where a client's People live for this person. Admins have the client page
 * in the Agency workspace; owners go to People in one of the client's sites
 * (the same rule as the legacy `/orgs/$orgId/members` redirect). A client with
 * no site has no People page to link to, so it is named without a link.
 */
function PeopleLink({
  me,
  organizationId,
}: {
  me: Me
  organizationId: string
}) {
  if (me.user.isAgencyAdmin) {
    return (
      <Link
        to="/agency/clients/$orgId"
        params={{ orgId: organizationId }}
        search={{ tab: 'people' }}
        data-testid={`delete-blocker-people-${organizationId}`}
        className="shrink-0 text-callout font-medium text-text-accent underline-offset-4 hover:underline"
      >
        {m.account_delete_people_link()}
      </Link>
    )
  }
  const site = me.sites.find((item) => item.organizationId === organizationId)
  if (!site) return null
  return (
    <Link
      to="/sites/$siteId/people"
      params={{ siteId: site.id }}
      data-testid={`delete-blocker-people-${organizationId}`}
      className="shrink-0 text-callout font-medium text-text-accent underline-offset-4 hover:underline"
    >
      {m.account_delete_people_link()}
    </Link>
  )
}
