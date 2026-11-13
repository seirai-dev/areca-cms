/**
 * Notification preferences: the pure resolution order from the spec, and the
 * rule/choice reads and writes around it. See
 * docs/design/email-notifications.md (Preference resolution).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { db } from '#/db'
import type { DbExecutor } from '#/db'
import { notificationPreference, notificationRule } from '#/db/schema'
import { EVENT_CATALOG } from '#/lib/notifications'
import type { EventKey, NotificationRole } from '#/lib/notifications'

export type RuleCell = { enabled: boolean; locked: boolean }

export type ResolvedPreference = {
  enabled: boolean
  /** Who forces it on, if anyone. */
  lockedBy: null | 'agency' | 'organization'
  /** Where the value comes from. */
  source:
    | 'agency_lock'
    | 'organization_lock'
    | 'user'
    | 'organization'
    | 'agency'
    | 'builtin'
}

/**
 * Pure. Spec order: agency lock → org lock → user → org default → agency
 * default → built-in. Agency-role and `agency.*` events ignore org rules.
 */
export function resolvePreference(input: {
  event: EventKey
  role: NotificationRole
  agencyRule?: RuleCell | null
  orgRule?: RuleCell | null
  userChoice?: boolean | null
}): ResolvedPreference {
  const { event, role, agencyRule, userChoice } = input
  const orgRule = isAgencyEvent(event, role) ? null : (input.orgRule ?? null)

  if (agencyRule?.locked) {
    return { enabled: true, lockedBy: 'agency', source: 'agency_lock' }
  }
  if (orgRule?.locked) {
    return {
      enabled: true,
      lockedBy: 'organization',
      source: 'organization_lock',
    }
  }
  if (userChoice !== undefined && userChoice !== null) {
    return { enabled: userChoice, lockedBy: null, source: 'user' }
  }
  if (orgRule) {
    return { enabled: orgRule.enabled, lockedBy: null, source: 'organization' }
  }
  if (agencyRule) {
    return { enabled: agencyRule.enabled, lockedBy: null, source: 'agency' }
  }
  return {
    enabled: EVENT_CATALOG[event].default,
    lockedBy: null,
    source: 'builtin',
  }
}

/** Agency-role recipients and `agency.*` events use agency rules and global choices. */
export function isAgencyEvent(event: EventKey, role: NotificationRole) {
  return role === 'agency' || event.startsWith('agency.')
}

/** Choices are keyed by organization; agency-role choices use `null`. */
export function choiceOrganization(
  role: NotificationRole,
  organizationId: string | null,
) {
  return role === 'agency' ? null : organizationId
}

export function ruleKey(event: EventKey, role: NotificationRole) {
  return `${event}:${role}`
}

export function choiceKey(
  userId: string,
  organizationId: string | null,
  event: EventKey,
) {
  return `${userId}:${organizationId ?? ''}:${event}`
}

/** Agency defaults and locks, keyed by `ruleKey`. */
export async function loadAgencyRules(connection: DbExecutor = db) {
  const rows = await connection
    .select()
    .from(notificationRule)
    .where(isNull(notificationRule.organizationId))
  return new Map(
    rows.map((row) => [
      ruleKey(row.event, row.role),
      { enabled: row.enabled, locked: row.locked },
    ]),
  )
}

/** Organization defaults and locks for one org, keyed by `ruleKey`. */
export async function loadOrganizationRules(
  organizationId: string,
  connection: DbExecutor = db,
) {
  const rows = await connection
    .select()
    .from(notificationRule)
    .where(eq(notificationRule.organizationId, organizationId))
  return new Map(
    rows.map((row) => [
      ruleKey(row.event, row.role),
      { enabled: row.enabled, locked: row.locked },
    ]),
  )
}

/** Choices of the given users across orgs (and agency alerts), keyed by `choiceKey`. */
export async function loadUserChoices(
  userIds: string[],
  connection: DbExecutor = db,
) {
  if (userIds.length === 0) return new Map<string, boolean>()
  const rows = await connection
    .select()
    .from(notificationPreference)
    .where(inArray(notificationPreference.userId, userIds))
  return new Map(
    rows.map((row) => [
      choiceKey(row.userId, row.organizationId, row.event),
      row.enabled,
    ]),
  )
}

/** Upserts an agency (org null) or organization default/lock. */
export async function writeRule(
  input: {
    organizationId: string | null
    event: EventKey
    role: NotificationRole
    enabled: boolean
    locked: boolean
    updatedBy: string
  },
  connection: DbExecutor = db,
) {
  const scope = input.organizationId ? 'organization' : 'agency'
  const now = new Date()
  await connection
    .insert(notificationRule)
    .values({
      scope,
      organizationId: input.organizationId,
      event: input.event,
      role: input.role,
      enabled: input.enabled,
      locked: input.locked,
      updatedBy: input.updatedBy,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        notificationRule.scope,
        notificationRule.organizationId,
        notificationRule.event,
        notificationRule.role,
      ],
      set: {
        enabled: input.enabled,
        locked: input.locked,
        updatedBy: input.updatedBy,
        updatedAt: now,
      },
    })
}

/** Removes an override so the level above (or the built-in) applies again. */
export async function clearRule(
  input: {
    organizationId: string | null
    event: EventKey
    role: NotificationRole
  },
  connection: DbExecutor = db,
) {
  await connection
    .delete(notificationRule)
    .where(
      and(
        input.organizationId
          ? eq(notificationRule.organizationId, input.organizationId)
          : isNull(notificationRule.organizationId),
        eq(
          notificationRule.scope,
          input.organizationId ? 'organization' : 'agency',
        ),
        eq(notificationRule.event, input.event),
        eq(notificationRule.role, input.role),
      ),
    )
}

/** Upserts a user's own choice. `organizationId` null is the agency-role choice. */
export async function writeChoice(
  input: {
    userId: string
    organizationId: string | null
    event: EventKey
    enabled: boolean
  },
  connection: DbExecutor = db,
) {
  await connection
    .insert(notificationPreference)
    .values({
      userId: input.userId,
      organizationId: input.organizationId,
      event: input.event,
      enabled: input.enabled,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        notificationPreference.userId,
        notificationPreference.organizationId,
        notificationPreference.event,
      ],
      set: { enabled: input.enabled, updatedAt: new Date() },
    })
}
