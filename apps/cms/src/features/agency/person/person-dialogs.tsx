import * as React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { FormField } from '#/components/ui/form-field'
import { Textarea } from '#/components/ui/textarea'
import { usePeopleMutations } from '#/features/agency/use-people-mutations'
import type { PersonDetail } from '#/features/agency/queries'
import { errorMessage } from '#/lib/admin/helpers'
import { m } from '#/paraglide/messages'

/** Which confirmation is open on the person page. */
export type PersonDialog =
  | { kind: 'block' }
  | { kind: 'unblock' }
  | { kind: 'delete' }
  | { kind: 'sign-out' }
  | { kind: 'reset-2fa' }
  | { kind: 'reset-password' }
  | { kind: 'admin'; next: boolean }

/** The block dialog's internal note is optional and never shown to the person. */
export const BLOCK_REASON_LIMIT = 500

/**
 * Every confirmation on the person page. Each destructive or step-up action
 * has one; the mutations handle step-up and refresh the caches. Results are
 * toasts; failures are toasts too, because the dialog closes either way.
 */
export function PersonDialogs({
  person,
  dialog,
  onClose,
}: {
  person: PersonDetail
  dialog: PersonDialog | null
  onClose: () => void
}) {
  const navigate = useNavigate()
  const mutations = usePeopleMutations()
  const [reason, setReason] = React.useState('')
  const open = (kind: PersonDialog['kind']) => dialog?.kind === kind
  const name = person.name
  const soleOwnerOf = person.memberships.filter(
    (item) => item.isOnlyOwner && item.role === 'owner',
  )

  function close(next: boolean) {
    if (!next) {
      setReason('')
      onClose()
    }
  }

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action()
      toast.success(success)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <>
      <Dialog open={open('block')} onOpenChange={close}>
        <DialogContent size="sm" data-testid="person-block-dialog">
          <DialogHeader>
            <DialogTitle>{m.agency_person_block_title({ name })}</DialogTitle>
            <DialogDescription>
              {m.agency_person_block_description()}
            </DialogDescription>
          </DialogHeader>
          <FormField
            label={m.agency_person_block_reason_label()}
            htmlFor="person-block-reason"
            hint={m.agency_person_block_reason_hint()}
          >
            <Textarea
              id="person-block-reason"
              rows={3}
              maxLength={BLOCK_REASON_LIMIT}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              data-testid="person-block-reason"
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              {m.shared_cancel()}
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={mutations.block.isPending}
              data-testid="confirm-action"
              onClick={async () => {
                await run(
                  () =>
                    mutations.block.mutateAsync({
                      userId: person.id,
                      reason: reason.trim() || undefined,
                    }),
                  m.agency_person_toast_blocked({ name }),
                )
                close(false)
              }}
            >
              {m.agency_person_block_confirm({ name })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={open('unblock')}
        onOpenChange={close}
        title={m.agency_person_unblock_title({ name })}
        description={m.agency_person_unblock_description()}
        confirmLabel={m.agency_person_unblock_confirm({ name })}
        onConfirm={() =>
          run(
            () => mutations.unblock.mutateAsync(person.id),
            m.agency_person_toast_unblocked({ name }),
          )
        }
        testId="person-unblock-dialog"
      />

      <ConfirmDialog
        open={open('sign-out')}
        onOpenChange={close}
        title={m.agency_person_sign_out_title({ name })}
        description={m.agency_person_sign_out_description()}
        confirmLabel={m.agency_person_sign_out_confirm()}
        variant="destructive"
        onConfirm={() =>
          run(
            () => mutations.signOutEverywhere.mutateAsync(person.id),
            m.agency_person_toast_signed_out({ name }),
          )
        }
        testId="person-sign-out-dialog"
      />

      <ConfirmDialog
        open={open('reset-2fa')}
        onOpenChange={close}
        title={m.agency_person_reset_2fa_title({ name })}
        description={m.agency_person_reset_2fa_description()}
        confirmLabel={m.agency_person_reset_2fa_confirm()}
        variant="destructive"
        onConfirm={() =>
          run(
            () => mutations.resetTwoFactor.mutateAsync(person.id),
            m.agency_person_toast_2fa_reset({ name }),
          )
        }
        testId="person-reset-2fa-dialog"
      />

      <ConfirmDialog
        open={open('reset-password')}
        onOpenChange={close}
        title={m.agency_people_reset_title()}
        description={m.agency_people_reset_body({ name })}
        confirmLabel={m.agency_people_reset_confirm()}
        onConfirm={async () => {
          try {
            const result = await mutations.sendResetLink.mutateAsync(person.id)
            if (!result.ok) {
              toast.error(result.message)
              return
            }
            toast.success(
              result.status === 'sso'
                ? m.agency_people_reset_sso({ name })
                : result.status === 'queued'
                  ? m.agency_people_reset_queued({ email: person.email })
                  : m.agency_people_reset_sent({ email: person.email }),
            )
          } catch (error) {
            toast.error(errorMessage(error))
          }
        }}
        testId="person-reset-password-dialog"
      />

      <ConfirmDialog
        open={open('admin')}
        onOpenChange={close}
        title={
          dialog?.kind === 'admin' && dialog.next
            ? m.admin_users_confirm_grant_title({ name })
            : m.admin_users_confirm_revoke_title({ name })
        }
        description={
          dialog?.kind === 'admin' && dialog.next
            ? m.admin_users_confirm_grant_description()
            : m.admin_users_confirm_revoke_description()
        }
        confirmLabel={
          dialog?.kind === 'admin' && dialog.next
            ? m.admin_users_confirm_grant_label()
            : m.admin_users_confirm_revoke_label()
        }
        variant={
          dialog?.kind === 'admin' && dialog.next ? 'default' : 'destructive'
        }
        onConfirm={() =>
          run(
            () =>
              mutations.setAgencyAdmin.mutateAsync({
                userId: person.id,
                isAgencyAdmin: dialog?.kind === 'admin' ? dialog.next : false,
              }),
            dialog?.kind === 'admin' && dialog.next
              ? m.admin_users_toast_granted()
              : m.admin_users_toast_removed(),
          )
        }
        testId="person-agency-admin-dialog"
      />

      <ConfirmDialog
        open={open('delete')}
        onOpenChange={close}
        title={m.agency_person_delete_title({ name })}
        description={
          <span className="grid gap-3">
            <span className="block">
              {m.agency_person_delete_description({ name })}
            </span>
            {soleOwnerOf.length > 0 ? (
              <span className="grid gap-2">
                <span className="block">
                  {m.agency_person_delete_no_owner_intro()}
                </span>
                <ul className="list-disc pl-5">
                  {soleOwnerOf.map((item) => (
                    <li key={item.organizationId}>{item.organizationName}</li>
                  ))}
                </ul>
              </span>
            ) : null}
          </span>
        }
        confirmLabel={m.agency_person_delete_confirm()}
        confirmText={person.email}
        confirmPrompt={m.agency_person_delete_type_prompt()}
        align="start"
        variant="destructive"
        onConfirm={async () => {
          try {
            await mutations.remove.mutateAsync(person.id)
            toast.success(m.agency_person_toast_deleted({ name }))
            void navigate({ to: '/agency/people' })
          } catch (error) {
            toast.error(errorMessage(error))
          }
        }}
        testId="person-delete-dialog"
      />
    </>
  )
}
