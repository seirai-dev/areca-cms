import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  requireAgencyAdmin,
  requireOrgMember,
  requireUser,
} from '#/lib/session.server'
import { NOTIFICATION_EVENTS } from '#/lib/notifications'
import type { EventKey } from '#/lib/notifications'
import { m } from '#/paraglide/messages'
import {
  buildAgencyMatrices,
  buildOrgMatrix,
  getMyNotifications,
  setAgencyRule,
  setMyPreference,
  setOrgRule,
} from '#/server/notifications/rules'
import {
  applyUnsubscribe,
  inspectUnsubscribe,
} from '#/server/notifications/unsubscribe'

const notificationsFn = { strict: { output: false } as const }

const eventSchema = z.enum(NOTIFICATION_EVENTS)
const orgRoleSchema = z.enum(['owner', 'editor'])
const agencyRoleSchema = z.enum(['owner', 'editor', 'agency'])
const tokenSchema = z.string().min(1).max(1000)

const orgRuleInput = z.union([
  z.object({
    organizationId: z.string().min(1),
    event: eventSchema,
    role: orgRoleSchema,
    enabled: z.boolean(),
    locked: z.boolean(),
  }),
  z.object({
    organizationId: z.string().min(1),
    event: eventSchema,
    role: orgRoleSchema,
    clear: z.literal(true),
  }),
])

const agencyRuleInput = z.union([
  z.object({
    event: eventSchema,
    role: agencyRoleSchema,
    enabled: z.boolean(),
    locked: z.boolean(),
  }),
  z.object({
    event: eventSchema,
    role: agencyRoleSchema,
    clear: z.literal(true),
  }),
])

/** Account → Notifications for the signed-in user. */
export const getMyNotificationsFn = createServerFn({
  method: 'GET',
  ...notificationsFn,
}).handler(async () => {
  const session = await requireUser()
  return getMyNotifications(session.user.id)
})

/**
 * Sets the caller's own choice for one event. `organizationId` null is the
 * agency-alert scope and needs an agency admin. Locked events refuse.
 */
export const setMyNotificationFn = createServerFn({
  method: 'POST',
  ...notificationsFn,
})
  .validator(
    z.object({
      organizationId: z.string().min(1).nullable(),
      event: eventSchema,
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const session = data.organizationId
      ? await requireOrgMember(data.organizationId)
      : await requireAgencyAdmin()
    return setMyPreference({
      userId: session.user.id,
      organizationId: data.organizationId,
      event: data.event,
      enabled: data.enabled,
    })
  })

/** Org owners (and agency admins) see the owner and editor defaults for one client. */
export const getOrgNotificationRulesFn = createServerFn({
  method: 'GET',
  ...notificationsFn,
})
  .validator(z.object({ organizationId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireOrgMember(data.organizationId, 'owner')
    return buildOrgMatrix(data.organizationId)
  })

/** Sets or clears an org default or lock. Agency-locked cells are refused. */
export const setOrgNotificationRuleFn = createServerFn({
  method: 'POST',
  ...notificationsFn,
})
  .validator(orgRuleInput)
  .handler(async ({ data }) => {
    const session = await requireOrgMember(data.organizationId, 'owner')
    return setOrgRule({
      organizationId: data.organizationId,
      actorId: session.user.id,
      request: toRuleRequest(data),
    })
  })

/** Agency admins see the client defaults and the agency-role alerts. */
export const getAgencyNotificationRulesFn = createServerFn({
  method: 'GET',
  ...notificationsFn,
}).handler(async () => {
  await requireAgencyAdmin()
  return buildAgencyMatrices()
})

/** Sets or clears an agency default or lock (for clients or agency alerts). */
export const setAgencyNotificationRuleFn = createServerFn({
  method: 'POST',
  ...notificationsFn,
})
  .validator(agencyRuleInput)
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    return setAgencyRule({
      actorId: session.user.id,
      request: toRuleRequest(data),
    })
  })

/** Public: what the unsubscribe page shows for a link. Changes nothing. */
export const getUnsubscribeFn = createServerFn({
  method: 'GET',
  ...notificationsFn,
})
  .validator(z.object({ token: tokenSchema }))
  .handler(async ({ data }) => {
    const result = await inspectUnsubscribe(data.token)
    return {
      status: result.status,
      event: result.event,
      orgName: result.orgName,
    }
  })

/** Public: turns the event off for the link's person and organization. */
export const confirmUnsubscribeFn = createServerFn({
  method: 'POST',
  ...notificationsFn,
})
  .validator(z.object({ token: tokenSchema }))
  .handler(async ({ data }) => {
    const result = await applyUnsubscribe(data.token)
    if (result.ok) return { ok: true as const }
    const message =
      result.reason === 'expired'
        ? m.server_notifications_unsubscribe_expired()
        : result.reason === 'locked'
          ? m.server_notifications_unsubscribe_locked()
          : m.server_notifications_unsubscribe_invalid()
    return { ok: false as const, message }
  })

function toRuleRequest(
  data:
    | {
        event: EventKey
        role: 'owner' | 'editor' | 'agency'
        enabled: boolean
        locked: boolean
      }
    | { event: EventKey; role: 'owner' | 'editor' | 'agency'; clear: true }
    | {
        organizationId: string
        event: EventKey
        role: 'owner' | 'editor'
        enabled: boolean
        locked: boolean
      }
    | {
        organizationId: string
        event: EventKey
        role: 'owner' | 'editor'
        clear: true
      },
) {
  if ('clear' in data)
    return { event: data.event, role: data.role, clear: true as const }
  return {
    event: data.event,
    role: data.role,
    enabled: data.enabled,
    locked: data.locked,
  }
}
