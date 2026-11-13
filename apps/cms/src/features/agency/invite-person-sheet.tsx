import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PaperPlaneTilt, Plus, X } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { SlideOver } from '#/components/ui/slide-over'
import { queryKeys } from '#/lib/query-keys'
import { errorMessage } from '#/lib/errors'
import type { MembershipRole } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { isValidEmail } from '#/features/people/use-members'
import { cn } from '#/lib/utils'

import { ClientPicker } from './client-picker'
import type { AccountRow, ClientRow } from './queries'
import { usePeopleMutations } from './use-people-mutations'

type Pick = {
  organizationId: string
  name: string
  slug: string
  role: MembershipRole
}

/**
 * Invite a person to one or more clients, each with its own role. An email
 * that already has an account is offered "Add to clients directly" instead:
 * no invitation, the memberships are created at once.
 */
export function InvitePersonSheet({
  open,
  onOpenChange,
  clients,
  accounts,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  clients: ClientRow[]
  accounts: AccountRow[]
}) {
  const queryClient = useQueryClient()
  const mutations = usePeopleMutations()
  const [email, setEmail] = React.useState('')
  const [picks, setPicks] = React.useState<Pick[]>([])
  const [showErrors, setShowErrors] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)

  const trimmed = email.trim()
  const emailValid = isValidEmail(trimmed)
  const match = React.useMemo(
    () =>
      trimmed
        ? accounts.find(
            (account) => account.email.toLowerCase() === trimmed.toLowerCase(),
          )
        : undefined,
    [accounts, trimmed],
  )
  const existing = React.useMemo(
    () =>
      new Map<string, MembershipRole>(
        (match?.memberships ?? []).map((item) => [
          item.organizationId,
          item.role,
        ]),
      ),
    [match],
  )
  const staged = React.useMemo(
    () => new Set(picks.map((pick) => pick.organizationId)),
    [picks],
  )

  function reset() {
    setEmail('')
    setPicks([])
    setShowErrors(false)
    setErrors({})
    setBusy(false)
  }

  function setRole(organizationId: string, role: MembershipRole) {
    setPicks((current) =>
      current.map((pick) =>
        pick.organizationId === organizationId ? { ...pick, role } : pick,
      ),
    )
  }

  function remove(organizationId: string) {
    setPicks((current) =>
      current.filter((pick) => pick.organizationId !== organizationId),
    )
    setErrors((current) => {
      const next = { ...current }
      delete next[organizationId]
      return next
    })
  }

  async function addDirectly() {
    if (!match) return
    // Clients the account already has were picked before the email matched.
    const add = picks
      .filter((pick) => !existing.has(pick.organizationId))
      .map((pick) => ({ organizationId: pick.organizationId, role: pick.role }))
    if (add.length === 0) return
    setBusy(true)
    try {
      await mutations.saveAccess.mutateAsync({
        userId: match.id,
        add,
        change: [],
        remove: [],
      })
      toast.success(m.agency_invite_added_directly({ name: match.name }))
      reset()
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  // One invitation per client, sent one after another, each with its own
  // error so a single failed client can be fixed without retyping the rest.
  async function sendInvitations() {
    if (!emailValid || picks.length === 0) {
      setShowErrors(true)
      return
    }
    setBusy(true)
    const nextErrors: Record<string, string> = {}
    let sent = 0
    for (const pick of picks) {
      try {
        await mutations.inviteToClient.mutateAsync({
          organizationId: pick.organizationId,
          email: trimmed,
          role: pick.role,
        })
        sent += 1
      } catch (error) {
        nextErrors[pick.organizationId] = errorMessage(error)
      }
    }
    setBusy(false)
    await queryClient.invalidateQueries({ queryKey: queryKeys.users() })
    if (sent > 0) {
      toast.success(
        sent === 1
          ? m.agency_invite_sent_one()
          : m.agency_invite_sent_many({ count: sent }),
      )
    }
    if (Object.keys(nextErrors).length === 0) {
      reset()
      onOpenChange(false)
      return
    }
    setErrors(nextErrors)
    setPicks((current) =>
      current.filter((pick) => nextErrors[pick.organizationId]),
    )
  }

  const sendLabel =
    picks.length === 1
      ? m.agency_invite_send_one()
      : m.agency_invite_send_many({ count: picks.length })

  return (
    <SlideOver
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        if (!next) reset()
        onOpenChange(next)
      }}
      title={m.agency_invite_title()}
      description={m.agency_invite_description()}
      wrapDescription
      data-testid="invite-person-sheet"
      footer={
        match ? (
          <div className="flex justify-end">
            <Button
              type="button"
              loading={busy}
              onClick={() => void addDirectly()}
              disabled={picks.length === 0}
              className="w-full sm:w-auto"
              data-testid="invite-person-add-direct"
            >
              {picks.length === 0
                ? m.agency_invite_pick_clients()
                : picks.length === 1
                  ? m.agency_invite_add_to_clients_one({ name: match.name })
                  : m.agency_invite_add_to_clients({
                      name: match.name,
                      count: picks.length,
                    })}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-caption font-normal text-text-muted">
              {m.people_invite_link_note()}
            </p>
            <Button
              type="button"
              loading={busy}
              onClick={() => void sendInvitations()}
              disabled={picks.length === 0}
              data-testid="invite-person-send"
            >
              {busy ? null : <PaperPlaneTilt />}
              {picks.length === 0 ? m.agency_invite_send_none() : sendLabel}
            </Button>
          </div>
        )
      }
    >
      <div className="grid gap-6 pt-2">
        <FormField
          label={m.agency_invite_email_label()}
          htmlFor="invite-person-email"
          error={
            showErrors && trimmed && !emailValid
              ? m.people_invite_emails_invalid({ email: trimmed })
              : undefined
          }
        >
          <Input
            id="invite-person-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            placeholder={m.admin_invite_placeholder()}
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
            data-testid="invite-person-email"
          />
        </FormField>

        {match ? (
          <div
            role="status"
            className="grid gap-3 rounded-card border border-border-default bg-background-subtle p-4"
            data-testid="invite-person-existing"
          >
            <p className="text-[14px] leading-5 font-medium text-text-primary">
              {m.agency_invite_existing_title({ name: match.name })}
            </p>
            <p className="text-callout text-text-secondary">
              {m.agency_invite_existing_description()}
            </p>
          </div>
        ) : null}

        <section
          className="grid gap-2.5"
          aria-labelledby="invite-person-clients"
        >
          <div className="flex items-center justify-between gap-3">
            <h3
              id="invite-person-clients"
              className="text-[13px] leading-[18px] font-medium text-text-primary"
            >
              {m.agency_invite_clients_label()}
            </h3>
            <ClientPicker
              clients={clients}
              existing={existing}
              staged={staged}
              onAdd={(added, role) =>
                setPicks((current) => [
                  ...current,
                  ...added.map((pick) => ({ ...pick, role })),
                ])
              }
              align="end"
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                data-testid="invite-person-clients-add"
              >
                <Plus />
                {m.agency_picker_open()}
              </Button>
            </ClientPicker>
          </div>

          {picks.length === 0 ? (
            <p
              className={cn(
                'rounded-card border border-dashed border-border-default px-4 py-5 text-center text-callout text-text-muted',
                showErrors && 'border-border-error text-text-error',
              )}
            >
              {m.agency_invite_clients_empty()}
            </p>
          ) : (
            <ul
              className="overflow-hidden rounded-card border border-border-default"
              data-testid="invite-person-picks"
            >
              {picks.map((pick) => (
                <li
                  key={pick.organizationId}
                  className="grid gap-2 border-b border-border-default px-3.5 py-3 last:border-b-0"
                  data-testid={`invite-person-pick-${pick.slug}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] leading-5 font-medium text-text-primary">
                        {pick.name}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={m.agency_invite_remove_client({
                        client: pick.name,
                      })}
                      onClick={() => remove(pick.organizationId)}
                      disabled={busy}
                      className="relative touch-target inline-flex size-7 shrink-0 items-center justify-center rounded-full text-icon-muted outline-none hover:bg-surface-state-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:opacity-40"
                    >
                      <X weight="bold" className="size-3.5" />
                    </button>
                  </div>
                  <SegmentedControl
                    size="sm"
                    aria-label={m.agency_person_role_for({ client: pick.name })}
                    value={pick.role}
                    onValueChange={(role) => setRole(pick.organizationId, role)}
                    data-testid={`invite-person-role-${pick.slug}`}
                    options={[
                      { value: 'editor', label: m.admin_role_editor() },
                      { value: 'owner', label: m.admin_role_owner() },
                    ]}
                  />
                  {errors[pick.organizationId] ? (
                    <p className="text-caption font-normal text-text-error">
                      {errors[pick.organizationId]}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </SlideOver>
  )
}
