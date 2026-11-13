/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
/**
 * One-click unsubscribe for notification emails. A token names one user, one
 * organization (null for agency-role alerts) and one event, signed with
 * BETTER_AUTH_SECRET. Tokens are never logged.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { organization } from '#/db/schema'
import { env } from '#/env'
import { isEventKey } from '#/lib/notifications'
import type { EventKey, NotificationRole } from '#/lib/notifications'
import { audit } from '#/server/audit'
import { membershipRole } from '#/server/security/org-role'

import {
  choiceKey,
  loadAgencyRules,
  loadOrganizationRules,
  loadUserChoices,
  resolvePreference,
  ruleKey,
  writeChoice,
} from './preferences.ts'

const TOKEN_TTL_SECONDS = 60 * 24 * 60 * 60
const SIGNING_PURPOSE = 'notifications:unsubscribe:'

export type UnsubscribeTarget = {
  userId: string
  organizationId: string | null
  event: EventKey
}

export type VerifiedToken =
  | ({ ok: true } & UnsubscribeTarget)
  | { ok: false; reason: 'invalid' | 'expired' }

export type UnsubscribeInspection = {
  status: 'ok' | 'already_off' | 'locked' | 'invalid' | 'expired'
  event?: EventKey
  organizationId?: string | null
  orgName?: string | null
  /** Who forces the email on when status is `locked`. */
  lockedBy?: 'agency' | 'organization' | null
}

type TargetState = {
  enabled: boolean
  lockedBy: 'agency' | 'organization' | null
}

function sign(payload: string) {
  return createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(`${SIGNING_PURPOSE}${payload}`)
    .digest('base64url')
}

export function signUnsubscribeToken(
  input: UnsubscribeTarget,
  now: Date = new Date(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      u: input.userId,
      o: input.organizationId,
      e: input.event,
      x: Math.floor(now.getTime() / 1000) + TOKEN_TTL_SECONDS,
    }),
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** Checks the signature first, then the expiry. Tampered tokens are always `invalid`. */
export function verifyUnsubscribeToken(
  token: string,
  now: Date = new Date(),
): VerifiedToken {
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'invalid' }
  const [payload = '', signature = ''] = parts
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(signature)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'invalid' }
  }

  let data: unknown
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (!data || typeof data !== 'object') return { ok: false, reason: 'invalid' }
  const { u, o, e, x } = data as Record<string, unknown>
  if (
    typeof u !== 'string' ||
    !(typeof o === 'string' || o === null) ||
    typeof e !== 'string' ||
    !isEventKey(e) ||
    typeof x !== 'number' ||
    !Number.isFinite(x)
  ) {
    return { ok: false, reason: 'invalid' }
  }
  if (x * 1000 <= now.getTime()) return { ok: false, reason: 'expired' }
  return { ok: true, userId: u, organizationId: o, event: e }
}

/**
 * The role a token's notification was sent under. Agency-role tokens carry no
 * organization; org tokens resolve to the membership role, or null when the
 * person is no longer a member.
 */
async function roleFor(
  target: UnsubscribeTarget,
): Promise<NotificationRole | null> {
  if (target.organizationId === null) return 'agency'
  return membershipRole(target.userId, target.organizationId)
}

/** Effective state for the token's event. Null when the person has no role there. */
async function targetState(
  target: UnsubscribeTarget,
): Promise<TargetState | null> {
  const role = await roleFor(target)
  if (!role) return null
  const agencyRules = await loadAgencyRules()
  const orgRules =
    target.organizationId && role !== 'agency'
      ? await loadOrganizationRules(target.organizationId)
      : new Map<string, { enabled: boolean; locked: boolean }>()
  const choices = await loadUserChoices([target.userId])
  const resolved = resolvePreference({
    event: target.event,
    role,
    agencyRule: agencyRules.get(ruleKey(target.event, role)),
    orgRule: orgRules.get(ruleKey(target.event, role)),
    userChoice: choices.get(
      choiceKey(
        target.userId,
        role === 'agency' ? null : target.organizationId,
        target.event,
      ),
    ),
  })
  return { enabled: resolved.enabled, lockedBy: resolved.lockedBy }
}

async function organizationName(organizationId: string | null) {
  if (!organizationId) return null
  const [row] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  return row?.name ?? null
}

/** Read-only view for the unsubscribe page. Never changes a preference. */
export async function inspectUnsubscribe(
  token: string,
  now: Date = new Date(),
): Promise<UnsubscribeInspection> {
  const verified = verifyUnsubscribeToken(token, now)
  if (!verified.ok) return { status: verified.reason }
  const state = await targetState(verified)
  if (!state) return { status: 'invalid' }
  const base = {
    event: verified.event,
    organizationId: verified.organizationId,
    orgName: await organizationName(verified.organizationId),
  }
  if (state.lockedBy) {
    return { status: 'locked', ...base, lockedBy: state.lockedBy }
  }
  return {
    status: state.enabled ? 'ok' : 'already_off',
    ...base,
    lockedBy: null,
  }
}

/**
 * Turns the event off for this user and organization. Locked events refuse
 * with `locked`. Used by the one-click API and the unsubscribe page.
 */
export async function applyUnsubscribe(
  token: string,
  now: Date = new Date(),
): Promise<
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'invalid' | 'expired' | 'locked' }
> {
  const verified = verifyUnsubscribeToken(token, now)
  if (!verified.ok) return verified
  const state = await targetState(verified)
  if (!state) return { ok: false, reason: 'invalid' }
  if (state.lockedBy) return { ok: false, reason: 'locked' }
  if (!state.enabled) return { ok: true, changed: false }

  await writeChoice({
    userId: verified.userId,
    organizationId: verified.organizationId,
    event: verified.event,
    enabled: false,
  })
  await audit({
    organizationId: verified.organizationId,
    actorId: verified.userId,
    action: 'notification_preference.update',
    targetType: 'user',
    targetId: verified.userId,
    meta: { event: verified.event, enabled: false, via: 'unsubscribe' },
  })
  return { ok: true, changed: true }
}
