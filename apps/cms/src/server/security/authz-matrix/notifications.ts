import type * as notificationsFns from '#/server/fn/notifications'

import type { MatrixFor } from './shared'

export const notificationsRows = {
  getMyNotificationsFn: {
    policy: 'user',
    doc: "the caller's own notification choices and org memberships",
    note: 'Only the caller own choices and the org memberships they hold.',
  },
  setMyNotificationFn: {
    policy: 'org-editor',
    doc: 'members change their own choice (agency admins for the agency scope); locked events refuse; a non-member admin gets a readable refusal',
    note: 'Members change their own choice. Agency admins outside the org get a readable refusal instead of a write.',
    prepare: (w) => ({
      data: {
        organizationId: w.X.org.id,
        event: 'release.live',
        enabled: true,
      },
    }),
  },
  getOrgNotificationRulesFn: {
    policy: 'org-owner',
    prepare: (w) => ({ data: { organizationId: w.X.org.id } }),
  },
  setOrgNotificationRuleFn: {
    policy: 'org-owner',
    doc: 'org owner, agency admin (MFA); agency-locked cells refuse changes',
    note: 'Clears an override only, so the shared test data keeps its rules.',
    prepare: (w) => ({
      data: {
        organizationId: w.X.org.id,
        event: 'release.live',
        role: 'editor',
        clear: true,
      },
    }),
  },
  getAgencyNotificationRulesFn: { policy: 'agency' },
  setAgencyNotificationRuleFn: {
    policy: 'agency',
    doc: 'agency admin (MFA); defaults and locks for clients and agency alerts',
    note: 'Clears an override only, so the shared test data keeps its rules.',
    prepare: () => ({
      data: { event: 'release.live', role: 'owner', clear: true },
    }),
  },
  getUnsubscribeFn: {
    policy: 'public',
    doc: 'reads a signed unsubscribe link; reveals only its status and event label',
    note: 'Public by design: the unsubscribe page reads a signed link. Reveals only the status of a valid link.',
    prepare: () => ({ data: { token: 'not-a-real-token' } }),
  },
  confirmUnsubscribeFn: {
    policy: 'public',
    doc: 'the signed link is the authorization; a locked, expired or invalid link changes nothing',
    note: 'Public by design: the signed link is the authorization. Invalid links change nothing.',
    prepare: () => ({ data: { token: 'not-a-real-token' } }),
  },
} satisfies MatrixFor<typeof notificationsFns>
