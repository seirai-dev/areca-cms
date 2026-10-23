import { createServerFn } from '@tanstack/react-start'
import { z } from '#/lib/zod'

import {
  requireAgencyAdmin,
  requireFreshAgencyAdmin,
} from '#/lib/session.server'
import {
  bulkAddUsersToClients,
  getUserDetail,
  setUserClientAccess,
} from '#/server/admin/user-access'
import {
  BLOCK_REASON_MAX_LENGTH,
  PERSON_NAME_MAX_LENGTH,
  blockUser,
  bulkBlockUsers,
  bulkSignOutUsers,
  bulkUnblockUsers,
  deleteUser,
  renameUser,
  resetTwoFactor,
  searchPeople,
  signOutEverywhere,
  unblockUser,
} from '#/server/admin/users'

/**
 * The agency People screens: one person's page, the bulk actions and the
 * people search. Self-service fns live in `account.ts`.
 */
const peopleFn = { strict: { output: false } as const }

const membershipRoleSchema = z.enum(['owner', 'editor'])
const userIdSchema = z.string().min(1)
const userIdsSchema = z.array(userIdSchema).min(1).max(200)
const reasonSchema = z.string().max(BLOCK_REASON_MAX_LENGTH).optional()
const accessGrantSchema = z.object({
  organizationId: z.string().min(1),
  role: membershipRoleSchema,
})

export const getUserDetailFn = createServerFn({ method: 'GET', ...peopleFn })
  .validator(z.object({ userId: userIdSchema }))
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    return getUserDetail(data.userId)
  })

export const blockUserFn = createServerFn({ method: 'POST', ...peopleFn })
  .validator(z.object({ userId: userIdSchema, reason: reasonSchema }))
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    await blockUser({
      actorId: session.user.id,
      userId: data.userId,
      reason: data.reason,
    })
    return { ok: true as const }
  })

export const unblockUserFn = createServerFn({ method: 'POST', ...peopleFn })
  .validator(z.object({ userId: userIdSchema }))
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    await unblockUser({ actorId: session.user.id, userId: data.userId })
    return { ok: true as const }
  })

export const deleteUserFn = createServerFn({ method: 'POST', ...peopleFn })
  .validator(z.object({ userId: userIdSchema }))
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    await deleteUser({ actorId: session.user.id, userId: data.userId })
    return { ok: true as const }
  })

export const resetUserTwoFactorFn = createServerFn({
  method: 'POST',
  ...peopleFn,
})
  .validator(z.object({ userId: userIdSchema }))
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    await resetTwoFactor({ actorId: session.user.id, userId: data.userId })
    return { ok: true as const }
  })

export const signOutUserEverywhereFn = createServerFn({
  method: 'POST',
  ...peopleFn,
})
  .validator(z.object({ userId: userIdSchema }))
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    return signOutEverywhere({
      actorId: session.user.id,
      userId: data.userId,
    })
  })

export const updateUserNameFn = createServerFn({ method: 'POST', ...peopleFn })
  .validator(
    z.object({
      userId: userIdSchema,
      name: z.string().trim().min(1).max(PERSON_NAME_MAX_LENGTH),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    await renameUser({
      actorId: session.user.id,
      userId: data.userId,
      name: data.name,
    })
    return { ok: true as const }
  })

/** One staged save from the person's page: adds, role changes and removals. */
export const setUserClientAccessFn = createServerFn({
  method: 'POST',
  ...peopleFn,
})
  .validator(
    z.object({
      userId: userIdSchema,
      add: z.array(accessGrantSchema).max(100).default([]),
      change: z.array(accessGrantSchema).max(100).default([]),
      remove: z.array(z.string().min(1)).max(100).default([]),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    return setUserClientAccess({
      actorId: session.user.id,
      userId: data.userId,
      add: data.add,
      change: data.change,
      remove: data.remove,
    })
  })

export const bulkBlockUsersFn = createServerFn({ method: 'POST', ...peopleFn })
  .validator(z.object({ userIds: userIdsSchema, reason: reasonSchema }))
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    return bulkBlockUsers({
      actorId: session.user.id,
      userIds: data.userIds,
      reason: data.reason,
    })
  })

export const bulkUnblockUsersFn = createServerFn({
  method: 'POST',
  ...peopleFn,
})
  .validator(z.object({ userIds: userIdsSchema }))
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    return bulkUnblockUsers({
      actorId: session.user.id,
      userIds: data.userIds,
    })
  })

export const bulkSignOutUsersFn = createServerFn({
  method: 'POST',
  ...peopleFn,
})
  .validator(z.object({ userIds: userIdsSchema }))
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    return bulkSignOutUsers({
      actorId: session.user.id,
      userIds: data.userIds,
    })
  })

export const bulkAddUsersToClientsFn = createServerFn({
  method: 'POST',
  ...peopleFn,
})
  .validator(
    z.object({
      userIds: userIdsSchema,
      organizationIds: z.array(z.string().min(1)).min(1).max(100),
      role: membershipRoleSchema,
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireFreshAgencyAdmin()
    return bulkAddUsersToClients({
      actorId: session.user.id,
      userIds: data.userIds,
      organizationIds: data.organizationIds,
      role: data.role,
    })
  })

/** Cmd+K people search: the top matches by name or email. */
export const searchPeopleFn = createServerFn({ method: 'GET', ...peopleFn })
  .validator(z.object({ query: z.string().max(200) }))
  .handler(async ({ data }) => {
    await requireAgencyAdmin()
    return searchPeople(data.query)
  })
