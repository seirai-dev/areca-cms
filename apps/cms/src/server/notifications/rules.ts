/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
/**
 * Preference and rule services behind the notification server functions.
 * Guards live in the functions; these functions trust their arguments and
 * record every change in the audit log.
 */
import { and, eq } from 'drizzle-orm'

import { db } from '#/db'
import { membership, organization, user } from '#/db/schema'
import {
  AGENCY_EVENTS,
  EVENT_CATALOG,
  ORG_EVENTS,
  eventReachesRole,
} from '#/lib/notifications'
import type {
  EventKey,
  MatrixCell,
  MyNotifications,
  NotificationRole,
  PreferenceRow,
  RulesMatrix,
} from '#/lib/notifications'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { getBranding } from '#/server/admin/branding'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '#/server/content/errors'
import { resolveMailConfig } from '#/server/mail/config'

import {
  choiceKey,
  choiceOrganization,
  clearRule,
  loadAgencyRules,
  loadOrganizationRules,
  loadUserChoices,
  resolvePreference,
  ruleKey,
  writeChoice,
  writeRule,
} from './preferences.ts'
import type { RuleCell } from './preferences.ts'

const ORG_ROLES: NotificationRole[] = ['owner', 'editor']

type RuleRequest =
  | {
      event: EventKey
      role: NotificationRole
      enabled: boolean
      locked: boolean
    }
  | { event: EventKey; role: NotificationRole; clear: true }

/** Account → Notifications: the caller's own choices across orgs. */
export async function getMyNotifications(
  userId: string,
): Promise<MyNotifications> {
  const [person] = await db
    .select({
      emailVerified: user.emailVerified,
      isAgencyAdmin: user.isAgencyAdmin,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!person) throw new NotFoundError(m.server_user_not_found())

  const [agencyRules, choices, memberships, branding, mailReady] =
    await Promise.all([
      loadAgencyRules(),
      loadUserChoices([userId]),
      db
        .select({
          organizationId: membership.organizationId,
          orgName: organization.name,
          role: membership.role,
        })
        .from(membership)
        .innerJoin(organization, eq(organization.id, membership.organizationId))
        .where(eq(membership.userId, userId))
        .orderBy(organization.name),
      getBranding(),
      resolveMailConfig().then((config) => config !== null),
    ])

  const orgs = await Promise.all(
    memberships.map(async (row) => {
      const orgRules = await loadOrganizationRules(row.organizationId)
      const role: 'owner' | 'editor' = row.role
      return {
        organizationId: row.organizationId,
        orgName: row.orgName,
        role,
        events: ORG_EVENTS.filter((event) => eventReachesRole(event, role)).map(
          (event) =>
            preferenceRow({
              userId,
              event,
              role,
              organizationId: row.organizationId,
              agencyRules,
              orgRules,
              choices,
            }),
        ),
      }
    }),
  )

  return {
    emailVerified: person.emailVerified,
    mailConfigured: mailReady,
    agencyName: branding.appName,
    orgs,
    agency: person.isAgencyAdmin
      ? {
          events: AGENCY_EVENTS.map((event) =>
            preferenceRow({
              userId,
              event,
              role: 'agency',
              organizationId: null,
              agencyRules,
              orgRules: new Map(),
              choices,
            }),
          ),
        }
      : null,
  }
}

function preferenceRow(input: {
  userId: string
  event: EventKey
  role: NotificationRole
  organizationId: string | null
  agencyRules: Map<string, RuleCell>
  orgRules: Map<string, RuleCell>
  choices: Map<string, boolean>
}): PreferenceRow {
  const key = ruleKey(input.event, input.role)
  const resolved = resolvePreference({
    event: input.event,
    role: input.role,
    agencyRule: input.agencyRules.get(key),
    orgRule: input.orgRules.get(key),
    userChoice: input.choices.get(
      choiceKey(
        input.userId,
        choiceOrganization(input.role, input.organizationId),
        input.event,
      ),
    ),
  })
  return {
    event: input.event,
    enabled: resolved.enabled,
    lockedBy: resolved.lockedBy,
  }
}

/**
 * Sets the caller's own choice. The role comes from the caller's membership
 * (or agency admin status for the global agency alerts). Locked events refuse.
 */
export async function setMyPreference(input: {
  userId: string
  organizationId: string | null
  event: EventKey
  enabled: boolean
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const role = await ownRoleFor(input.userId, input.organizationId)
  if (!role || !eventReachesRole(input.event, role)) {
    return { ok: false, message: m.server_notifications_role_not_allowed() }
  }
  const agencyRules = await loadAgencyRules()
  const orgRules = input.organizationId
    ? await loadOrganizationRules(input.organizationId)
    : new Map<string, RuleCell>()
  const resolved = resolvePreference({
    event: input.event,
    role,
    agencyRule: agencyRules.get(ruleKey(input.event, role)),
    orgRule: orgRules.get(ruleKey(input.event, role)),
  })
  // A locked event is already on, so asking for "on" succeeds; only "off" is refused.
  if (resolved.lockedBy && input.enabled) return { ok: true }
  if (resolved.lockedBy === 'agency') {
    const branding = await getBranding()
    return {
      ok: false,
      message: m.server_notifications_locked_by_agency({
        agency: branding.appName,
      }),
    }
  }
  if (resolved.lockedBy === 'organization' && input.organizationId) {
    return {
      ok: false,
      message: m.server_notifications_locked_by_org({
        org: await organizationName(input.organizationId),
      }),
    }
  }

  const organizationId = choiceOrganization(role, input.organizationId)
  await writeChoice({
    userId: input.userId,
    organizationId,
    event: input.event,
    enabled: input.enabled,
  })
  await audit({
    organizationId,
    actorId: input.userId,
    action: 'notification_preference.update',
    targetType: 'user',
    targetId: input.userId,
    meta: { event: input.event, enabled: input.enabled },
  })
  return { ok: true }
}

/** Member role, or 'agency' for an agency admin on the global (null) scope. */
async function ownRoleFor(
  userId: string,
  organizationId: string | null,
): Promise<NotificationRole | null> {
  if (!organizationId) {
    const [person] = await db
      .select({ isAgencyAdmin: user.isAgencyAdmin })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    return person?.isAgencyAdmin ? 'agency' : null
  }
  const [member] = await db
    .select({ role: membership.role })
    .from(membership)
    .where(
      and(
        eq(membership.userId, userId),
        eq(membership.organizationId, organizationId),
      ),
    )
    .limit(1)
  return member?.role ?? null
}

async function organizationName(organizationId: string) {
  const [row] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  return row?.name ?? ''
}

/** Matrix for an org: owner and editor columns. Agency defaults show through. */
export async function buildOrgMatrix(
  organizationId: string,
): Promise<RulesMatrix & { orgName: string; agencyName: string }> {
  const [agencyRules, orgRules, orgName, branding] = await Promise.all([
    loadAgencyRules(),
    loadOrganizationRules(organizationId),
    organizationName(organizationId),
    getBranding(),
  ])
  return {
    orgName,
    agencyName: branding.appName,
    rows: ORG_EVENTS.map((event) => ({
      event,
      cells: Object.fromEntries(
        ORG_ROLES.filter((role) => eventReachesRole(event, role)).map(
          (role) => [
            role,
            orgCell(
              agencyRules.get(ruleKey(event, role)),
              orgRules.get(ruleKey(event, role)),
              event,
            ),
          ],
        ),
      ),
    })),
  }
}

function orgCell(
  agency: RuleCell | undefined,
  org: RuleCell | undefined,
  event: EventKey,
): MatrixCell {
  if (agency?.locked) {
    return {
      enabled: true,
      locked: true,
      overridden: Boolean(org),
      lockedAbove: true,
    }
  }
  if (org) {
    return {
      enabled: org.enabled,
      locked: org.locked,
      overridden: true,
      lockedAbove: false,
    }
  }
  return {
    enabled: agency ? agency.enabled : EVENT_CATALOG[event].default,
    locked: false,
    overridden: false,
    lockedAbove: false,
  }
}

/** Sets or clears an org default or lock. Agency-locked cells refuse changes. */
export async function setOrgRule(input: {
  organizationId: string
  actorId: string
  request: RuleRequest
}): Promise<RulesMatrix & { orgName: string; agencyName: string }> {
  const { organizationId, actorId, request } = input
  assertReachable(request.event, request.role, ORG_ROLES)
  if (!('clear' in request)) {
    const agencyRules = await loadAgencyRules()
    if (agencyRules.get(ruleKey(request.event, request.role))?.locked) {
      const branding = await getBranding()
      throw new ConflictError(
        m.server_notifications_locked_above({ agency: branding.appName }),
      )
    }
  }
  if ('clear' in request) {
    await clearRule({
      organizationId,
      event: request.event,
      role: request.role,
    })
  } else {
    await writeRule({
      organizationId,
      event: request.event,
      role: request.role,
      enabled: request.locked ? true : request.enabled,
      locked: request.locked,
      updatedBy: actorId,
    })
  }
  await audit({
    organizationId,
    actorId,
    action: 'notification_rule.update',
    targetType: 'organization',
    targetId: organizationId,
    meta: { event: request.event, role: request.role, ...describe(request) },
  })
  return buildOrgMatrix(organizationId)
}

/** Agency matrices: client defaults (owner/editor) and agency-role alerts. */
export async function buildAgencyMatrices(): Promise<{
  clients: RulesMatrix
  agency: RulesMatrix
}> {
  const rules = await loadAgencyRules()
  const cell = (event: EventKey, role: NotificationRole): MatrixCell => {
    const rule = rules.get(ruleKey(event, role))
    return {
      enabled: rule ? rule.enabled : EVENT_CATALOG[event].default,
      locked: rule?.locked ?? false,
      overridden: Boolean(rule),
      lockedAbove: false,
    }
  }
  return {
    clients: {
      rows: ORG_EVENTS.map((event) => ({
        event,
        cells: Object.fromEntries(
          ORG_ROLES.filter((role) => eventReachesRole(event, role)).map(
            (role) => [role, cell(event, role)],
          ),
        ),
      })),
    },
    agency: {
      rows: AGENCY_EVENTS.map((event) => ({
        event,
        cells: { agency: cell(event, 'agency') },
      })),
    },
  }
}

/** Sets or clears an agency default or lock (org null). */
export async function setAgencyRule(input: {
  actorId: string
  request: RuleRequest
}) {
  const { actorId, request } = input
  assertReachable(request.event, request.role, [...ORG_ROLES, 'agency'])
  if ('clear' in request) {
    await clearRule({
      organizationId: null,
      event: request.event,
      role: request.role,
    })
  } else {
    await writeRule({
      organizationId: null,
      event: request.event,
      role: request.role,
      enabled: request.locked ? true : request.enabled,
      locked: request.locked,
      updatedBy: actorId,
    })
  }
  await audit({
    organizationId: null,
    actorId,
    action: 'notification_rule.update',
    targetType: 'notification_rule',
    targetId: `${request.event}:${request.role}`,
    meta: { event: request.event, role: request.role, ...describe(request) },
  })
  return buildAgencyMatrices()
}

function assertReachable(
  event: EventKey,
  role: NotificationRole,
  allowed: NotificationRole[],
) {
  if (!allowed.includes(role) || !eventReachesRole(event, role)) {
    throw new ValidationError([
      { path: 'role', message: m.server_notifications_role_not_allowed() },
    ])
  }
}

function describe(request: RuleRequest) {
  return 'clear' in request
    ? { cleared: true }
    : { enabled: request.enabled, locked: request.locked }
}
