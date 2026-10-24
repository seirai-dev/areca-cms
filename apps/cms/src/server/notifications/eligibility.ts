/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
/**
 * Send-time check for notification emails. The row and its email were written
 * when the event happened. Access and preferences can change before the email
 * goes out (a member is removed, a role changes, someone turns the kind off),
 * so the outbox asks here right before delivery. Account and security emails
 * never go through this: they have no notification row.
 */
import { and, eq } from 'drizzle-orm'

import { db } from '#/db'
import { membership, notification, user } from '#/db/schema'

import {
  choiceKey,
  choiceOrganization,
  loadAgencyRules,
  loadOrganizationRules,
  loadUserChoices,
  resolvePreference,
  ruleKey,
} from './preferences.ts'

/**
 * True when the recipient still has access to the organization (or is still an
 * agency admin, for agency alerts) and their preference still allows the
 * event. A missing notification row (already purged) is not eligible.
 */
export async function notificationStillEligible(
  notificationId: string,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(notification)
    .where(eq(notification.id, notificationId))
    .limit(1)
  if (!row) return false
  const role = row.payload.recipientRole
  const organizationId = row.organizationId
  if (!role) return false
  const [recipient] = await db
    .select({ blockedAt: user.blockedAt })
    .from(user)
    .where(eq(user.id, row.userId))
    .limit(1)
  if (!recipient || recipient.blockedAt) return false

  if (role === 'agency') {
    const [person] = await db
      .select({ isAgencyAdmin: user.isAgencyAdmin })
      .from(user)
      .where(eq(user.id, row.userId))
      .limit(1)
    if (!person?.isAgencyAdmin) return false
  } else {
    if (!organizationId) return false
    const [member] = await db
      .select({ id: membership.id })
      .from(membership)
      .where(
        and(
          eq(membership.userId, row.userId),
          eq(membership.organizationId, organizationId),
        ),
      )
      .limit(1)
    if (!member) return false
  }

  const [agencyRules, orgRules, choices] = await Promise.all([
    loadAgencyRules(),
    organizationId ? loadOrganizationRules(organizationId) : null,
    loadUserChoices([row.userId]),
  ])
  const key = ruleKey(row.event, role)
  const resolved = resolvePreference({
    event: row.event,
    role,
    agencyRule: agencyRules.get(key),
    orgRule: orgRules?.get(key),
    userChoice: choices.get(
      choiceKey(
        row.userId,
        choiceOrganization(role, organizationId),
        row.event,
      ),
    ),
  })
  return resolved.enabled
}
