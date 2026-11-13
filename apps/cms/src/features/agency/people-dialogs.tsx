import { toast } from 'sonner'

import { BlockPersonDialog } from '#/features/agency/person/block-person-dialog'
import type { usePeopleMutations } from '#/features/agency/use-people-mutations'
import { RegeneratedLinkDialog } from '#/features/people/regenerated-link-dialog'
import type { RegeneratedLink } from '#/features/people/use-members'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { m } from '#/paraglide/messages'
import type { BulkResult } from '#/server/admin/users'

type Mutations = ReturnType<typeof usePeopleMutations>

export type BulkAction = 'block' | 'unblock' | 'sign-out'
type ConfirmKind = 'reset' | 'lockout' | 'revoke' | 'unblock' | 'sign-out'

/** The person or invitation a row dialog acts on (an invitation's name is its email). */
export type DialogTarget = { id: string; name: string; email: string }

/** The People screen opens one dialog at a time. */
export type PeopleDialog =
  | { kind: ConfirmKind | 'block'; target: DialogTarget }
  | { kind: 'bulk'; action: BulkAction }
  | { kind: 'link'; link: RegeneratedLink; email: string }

/** "Blocked 1 person" or "Blocked 3 people", from the count. */
export function counted(
  count: number,
  one: () => string,
  many: (params: { count: number }) => string,
) {
  return count === 1 ? one() : many({ count })
}

export const BULK: Record<
  BulkAction,
  {
    /** The floating bar's button. */
    label: () => string
    title: (count: number) => string
    description: () => string
    confirm: (count: number) => string
    done: (count: number) => string
    variant: 'default' | 'destructive'
    run: (mutations: Mutations, userIds: string[]) => Promise<BulkResult>
  }
> = {
  block: {
    label: m.agency_people_bulk_block,
    title: (count) =>
      counted(
        count,
        m.agency_people_bulk_block_title_one,
        m.agency_people_bulk_block_title,
      ),
    description: m.agency_people_bulk_block_description,
    confirm: (count) =>
      counted(
        count,
        m.agency_people_bulk_block_confirm_one,
        m.agency_people_bulk_block_confirm,
      ),
    done: (count) =>
      counted(
        count,
        m.agency_people_toast_blocked_one,
        m.agency_people_toast_blocked,
      ),
    variant: 'destructive',
    run: (mutations, userIds) => mutations.bulkBlock.mutateAsync({ userIds }),
  },
  unblock: {
    label: m.agency_people_bulk_unblock,
    title: (count) =>
      counted(
        count,
        m.agency_people_bulk_unblock_title_one,
        m.agency_people_bulk_unblock_title,
      ),
    description: m.agency_people_bulk_unblock_description,
    confirm: (count) =>
      counted(
        count,
        m.agency_people_bulk_unblock_confirm_one,
        m.agency_people_bulk_unblock_confirm,
      ),
    done: (count) =>
      counted(
        count,
        m.agency_people_toast_unblocked_one,
        m.agency_people_toast_unblocked,
      ),
    variant: 'default',
    run: (mutations, userIds) => mutations.bulkUnblock.mutateAsync(userIds),
  },
  'sign-out': {
    label: m.agency_people_bulk_sign_out,
    title: (count) =>
      counted(
        count,
        m.agency_people_bulk_sign_out_title_one,
        m.agency_people_bulk_sign_out_title,
      ),
    description: m.agency_people_bulk_sign_out_description,
    confirm: (count) =>
      counted(
        count,
        m.agency_people_bulk_sign_out_confirm_one,
        m.agency_people_bulk_sign_out_confirm,
      ),
    done: (count) =>
      counted(
        count,
        m.agency_people_toast_signed_out_one,
        m.agency_people_toast_signed_out,
      ),
    variant: 'destructive',
    run: (mutations, userIds) => mutations.bulkSignOut.mutateAsync(userIds),
  },
}

const CONFIRMS: Record<
  ConfirmKind,
  {
    title: (target: DialogTarget) => string
    description: (target: DialogTarget) => string
    confirm: (target: DialogTarget) => string
    variant: 'default' | 'destructive'
    testId: string
    /** Returns the success toast, or null when it reported the outcome itself. */
    run: (mutations: Mutations, target: DialogTarget) => Promise<string | null>
  }
> = {
  reset: {
    title: () => m.agency_people_reset_title(),
    description: ({ name }) => m.agency_people_reset_body({ name }),
    confirm: () => m.agency_people_reset_confirm(),
    variant: 'default',
    testId: 'send-reset-link-dialog',
    run: async (mutations, target) => {
      const result = await mutations.sendResetLink.mutateAsync(target.id)
      if (!result.ok) {
        toast.error(result.message, {
          description: result.ref
            ? m.agency_mail_reference({ id: result.ref })
            : undefined,
        })
        return null
      }
      return resetLinkSentMessage(result.status, target)
    },
  },
  lockout: {
    title: () => m.account_factor_lockout_reset(),
    description: () => m.account_factor_lockout_reset_description(),
    confirm: () => m.account_factor_lockout_reset(),
    variant: 'default',
    testId: 'reset-factor-lockout-dialog',
    run: async (mutations, target) => {
      await mutations.resetLockout.mutateAsync(target.id)
      return m.account_factor_lockout_reset_success()
    },
  },
  revoke: {
    title: () => m.admin_invitations_revoke_title(),
    description: ({ email }) =>
      m.admin_invitations_revoke_description({ email }),
    confirm: () => m.admin_invitations_revoke_label(),
    variant: 'destructive',
    testId: 'revoke-invitation-dialog',
    run: async (mutations, target) => {
      await mutations.revokeInvitation.mutateAsync(target.id)
      return m.admin_members_toast_revoked()
    },
  },
  unblock: {
    title: ({ name }) => m.agency_person_unblock_title({ name }),
    description: () => m.agency_person_unblock_description(),
    confirm: ({ name }) => m.agency_person_unblock_confirm({ name }),
    variant: 'default',
    testId: 'people-row-unblock-dialog',
    run: async (mutations, target) => {
      await mutations.unblock.mutateAsync(target.id)
      return m.agency_person_toast_unblocked({ name: target.name })
    },
  },
  'sign-out': {
    title: ({ name }) => m.agency_person_sign_out_title({ name }),
    description: () => m.agency_person_sign_out_description(),
    confirm: () => m.agency_person_sign_out_confirm(),
    variant: 'destructive',
    testId: 'people-row-sign-out-dialog',
    run: async (mutations, target) => {
      await mutations.signOutEverywhere.mutateAsync(target.id)
      return m.agency_person_toast_signed_out({ name: target.name })
    },
  },
}

/** The success toast says what happened to the link: sent, queued, or the provider pointer. */
function resetLinkSentMessage(
  status: 'sent' | 'queued' | 'sso',
  target: DialogTarget,
) {
  if (status === 'sso') return m.agency_people_reset_sso({ name: target.name })
  if (status === 'queued') {
    return m.agency_people_reset_queued({ email: target.email })
  }
  return m.agency_people_reset_sent({ email: target.email })
}

/**
 * Renders the open dialog. `dialog` stays set while it closes (`open` false),
 * so the copy does not change during the exit animation.
 */
export function PeopleDialogs({
  dialog,
  open,
  onClose,
  mutations,
  pickedCount,
  onConfirmBulk,
}: {
  dialog: PeopleDialog | null
  open: boolean
  onClose: () => void
  mutations: Mutations
  pickedCount: number
  onConfirmBulk: (action: BulkAction) => Promise<void>
}) {
  if (!dialog) return null
  const onOpenChange = (next: boolean) => {
    if (!next) onClose()
  }

  if (dialog.kind === 'block') {
    return (
      <BlockPersonDialog
        open={open}
        onClose={onClose}
        userId={dialog.target.id}
        name={dialog.target.name}
      />
    )
  }

  if (dialog.kind === 'link') {
    return (
      <RegeneratedLinkDialog
        link={open ? dialog.link : null}
        email={dialog.email}
        onClose={onClose}
      />
    )
  }

  if (dialog.kind === 'bulk') {
    const bulk = BULK[dialog.action]
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title={bulk.title(pickedCount)}
        description={bulk.description()}
        confirmLabel={bulk.confirm(pickedCount)}
        variant={bulk.variant}
        onConfirm={async () => {
          onClose()
          await onConfirmBulk(dialog.action)
        }}
        testId="people-bulk-confirm"
      />
    )
  }

  const config = CONFIRMS[dialog.kind]
  const { target } = dialog
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={config.title(target)}
      description={config.description(target)}
      confirmLabel={config.confirm(target)}
      variant={config.variant}
      onConfirm={async () => {
        const success = await config.run(mutations, target)
        if (success) toast.success(success)
      }}
      testId={config.testId}
    />
  )
}
