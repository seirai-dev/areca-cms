import * as React from 'react'
import {
  CheckCircle,
  PaperPlaneTilt,
  PencilSimple,
  Crown,
  Warning,
  XCircle,
} from '@phosphor-icons/react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { RadioCard, RadioCards } from '#/components/ui/radio-cards'
import { SlideOver } from '#/components/ui/slide-over'
import type { MembershipRole } from '#/lib/types'
import { m } from '#/paraglide/messages'

import { isValidEmail, parseEmails } from './use-members'
import type { InviteResult, useMembers } from './use-members'

/**
 * Invite sheet (brief §3.9): one field that takes several comma-separated
 * addresses, role cards, "Send invitation". Addresses are sent one after
 * another; failures stay in the field with their reason so they can be fixed.
 */
export function InviteSheet({
  open,
  onOpenChange,
  organizationName,
  invite,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationName: string
  invite: ReturnType<typeof useMembers>['invite']
}) {
  const formId = React.useId()
  const [value, setValue] = React.useState('')
  const [role, setRole] = React.useState<MembershipRole>('editor')
  const [error, setError] = React.useState<string | undefined>()
  const [results, setResults] = React.useState<InviteResult[]>([])
  const [progress, setProgress] = React.useState<number | null>(null)

  const emails = parseEmails(value)
  const sending = invite.isPending

  function reset() {
    setValue('')
    setRole('editor')
    setError(undefined)
    setResults([])
    setProgress(null)
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (sending) return
    if (emails.length === 0) {
      setError(m.people_invite_emails_required())
      return
    }
    const invalid = emails.find((email) => !isValidEmail(email))
    if (invalid) {
      setError(m.people_invite_emails_invalid({ email: invalid }))
      return
    }
    setError(undefined)
    setResults([])
    const outcome = await invite.mutateAsync({
      emails,
      role,
      onProgress: (index) => setProgress(index),
    })
    setProgress(null)
    const sent = outcome.filter((item) => item.ok)
    // Created-but-undelivered invitations are resent from the list, not retyped.
    const failed = outcome.filter((item) => !item.ok && !item.created)
    if (sent.length > 0) {
      toast.success(
        sent.length === 1
          ? m.admin_members_toast_invited()
          : m.people_invite_sent_many({ count: sent.length }),
      )
    }
    if (failed.length === 0 && outcome.every((item) => item.ok)) {
      reset()
      onOpenChange(false)
      return
    }
    // Keep only the addresses that need another look.
    setResults(outcome)
    setValue(failed.map((item) => item.email).join(', '))
  }

  const sendLabel = sending
    ? emails.length > 1 && progress !== null
      ? m.people_invite_sending_progress({
          current: progress + 1,
          total: emails.length,
        })
      : m.admin_sending()
    : emails.length > 1
      ? m.people_invite_send_many({ count: emails.length })
      : m.admin_invite_send()

  return (
    <SlideOver
      open={open}
      onOpenChange={(next) => {
        if (sending) return
        if (!next) reset()
        onOpenChange(next)
      }}
      title={m.people_invite_people()}
      description={m.people_invite_sheet_description({
        client: organizationName,
      })}
      data-testid="invite-sheet"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-caption font-normal text-text-muted">
            {m.people_invite_link_note()}
          </p>
          <Button
            type="submit"
            form={formId}
            loading={sending}
            data-testid="invite-send"
          >
            {sending ? null : <PaperPlaneTilt />}
            {sendLabel}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={onSubmit}
        className="grid gap-6 pt-2"
      >
        <FormField
          label={m.people_invite_emails_label()}
          htmlFor="invite-email"
          hint={error ? undefined : m.people_invite_emails_hint()}
          error={error}
        >
          <Input
            id="invite-email"
            data-testid="invite-email"
            type="email"
            multiple
            autoFocus
            autoComplete="email"
            inputMode="email"
            placeholder={m.admin_invite_placeholder()}
            value={value}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setValue(event.target.value)
              if (error) setError(undefined)
            }}
            disabled={sending}
          />
        </FormField>

        {results.length > 0 ? (
          <div
            role="alert"
            className="grid gap-2 rounded-card border border-border-default bg-background-subtle p-3.5"
            data-testid="invite-results"
          >
            <p className="text-[14px] leading-5 font-medium text-text-primary">
              {m.people_invite_results_title()}
            </p>
            <ul className="grid gap-1.5">
              {results.map((item) => (
                <li
                  key={item.email}
                  className="flex items-start gap-2 text-callout"
                >
                  {item.ok ? (
                    <CheckCircle
                      weight="fill"
                      className="mt-0.5 size-4 shrink-0 text-icon-success"
                    />
                  ) : item.created ? (
                    <Warning
                      weight="fill"
                      className="mt-0.5 size-4 shrink-0 text-icon-warning"
                    />
                  ) : (
                    <XCircle
                      weight="fill"
                      className="mt-0.5 size-4 shrink-0 text-icon-error"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="font-medium break-all text-text-primary">
                      {item.email}
                    </span>
                    <span className="text-text-secondary">
                      {' · '}
                      {item.ok
                        ? m.people_invite_result_sent()
                        : item.created
                          ? m.people_invite_result_created_not_sent()
                          : item.error}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-caption font-normal text-text-muted">
              {m.people_invite_results_hint()}
            </p>
          </div>
        ) : null}

        <fieldset className="grid gap-2" disabled={sending}>
          <legend className="mb-2 text-[13px] leading-[18px] font-medium text-text-primary">
            {m.people_invite_role_label()}
          </legend>
          <RadioCards
            value={role}
            onValueChange={(next) => setRole(next as MembershipRole)}
            aria-label={m.people_invite_role_label()}
            data-testid="invite-role"
          >
            <RadioCard
              value="editor"
              icon={<PencilSimple />}
              title={m.people_role_editor()}
              description={m.people_role_editor_description()}
              data-testid="invite-role-editor"
            />
            <RadioCard
              value="owner"
              icon={<Crown />}
              title={m.people_role_owner()}
              description={m.people_role_owner_description()}
              data-testid="invite-role-owner"
            />
          </RadioCards>
        </fieldset>
      </form>
    </SlideOver>
  )
}
