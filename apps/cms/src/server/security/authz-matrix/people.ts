import type * as peopleFns from '#/server/fn/people'
import { and, eq, isNull } from 'drizzle-orm'
import { membership, user } from '#/db/schema'

import { absent, exists } from './shared'
import type { MatrixFor } from './shared'

export const peopleRows = {
  getUserDetailFn: {
    policy: 'agency',
    prepare: (w) => ({ data: { userId: w.users.editorX.id } }),
  },
  blockUserFn: {
    policy: 'agency-fresh',
    prepare: async (w) => {
      const target = await w.fresh.user('block-target')
      return {
        data: { userId: target.id, reason: 'Authz matrix' },
        untouched: exists(
          user,
          and(eq(user.id, target.id), isNull(user.blockedAt)),
        ),
      }
    },
  },
  unblockUserFn: {
    policy: 'agency-fresh',
    prepare: async (w) => {
      const target = await w.fresh.user('unblock-target')
      return { data: { userId: target.id } }
    },
  },
  deleteUserFn: {
    policy: 'agency-fresh',
    prepare: async (w) => {
      const target = await w.fresh.user('delete-target')
      return {
        data: { userId: target.id },
        untouched: exists(user, eq(user.id, target.id)),
      }
    },
  },
  resetUserTwoFactorFn: {
    policy: 'agency-fresh',
    prepare: async (w) => {
      const target = await w.fresh.user('reset-2fa-target')
      return {
        data: { userId: target.id },
        untouched: exists(user, eq(user.id, target.id)),
      }
    },
  },
  signOutUserEverywhereFn: {
    policy: 'agency-fresh',
    prepare: async (w) => {
      const target = await w.fresh.user('signout-target')
      return { data: { userId: target.id } }
    },
  },
  updateUserNameFn: {
    policy: 'agency',
    prepare: async (w) => {
      const target = await w.fresh.user('rename-target')
      return {
        data: { userId: target.id, name: 'Renamed Person' },
        untouched: exists(
          user,
          and(eq(user.id, target.id), eq(user.name, target.name)),
        ),
      }
    },
  },
  setUserClientAccessFn: {
    policy: 'agency',
    prepare: async (w) => {
      const target = await w.fresh.user('access-target')
      return {
        data: {
          userId: target.id,
          add: [{ organizationId: w.X.org.id, role: 'editor' }],
          change: [],
          remove: [],
        },
        untouched: absent(membership, eq(membership.userId, target.id)),
      }
    },
  },
  bulkBlockUsersFn: {
    policy: 'agency-fresh',
    prepare: async (w) => {
      const target = await w.fresh.user('bulk-block-target')
      return {
        data: { userIds: [target.id] },
        untouched: exists(
          user,
          and(eq(user.id, target.id), isNull(user.blockedAt)),
        ),
      }
    },
  },
  bulkUnblockUsersFn: {
    policy: 'agency-fresh',
    prepare: async (w) => {
      const target = await w.fresh.user('bulk-unblock-target')
      return { data: { userIds: [target.id] } }
    },
  },
  bulkSignOutUsersFn: {
    policy: 'agency-fresh',
    prepare: async (w) => {
      const target = await w.fresh.user('bulk-signout-target')
      return { data: { userIds: [target.id] } }
    },
  },
  bulkAddUsersToClientsFn: {
    policy: 'agency-fresh',
    prepare: async (w) => {
      const target = await w.fresh.user('bulk-add-target')
      return {
        data: {
          userIds: [target.id],
          organizationIds: [w.X.org.id],
          role: 'editor',
        },
        untouched: absent(membership, eq(membership.userId, target.id)),
      }
    },
  },
  searchPeopleFn: {
    policy: 'agency',
    prepare: () => ({ data: { query: 'authz' } }),
  },
} satisfies MatrixFor<typeof peopleFns>
