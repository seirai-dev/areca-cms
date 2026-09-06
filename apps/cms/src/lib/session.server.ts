import { redirect } from '@tanstack/react-router'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'

import { db } from '#/db'
import { membership } from '#/db/schema'

import type { MembershipRole } from './types.ts'
import { auth } from './auth.ts'

const roleRank: Record<MembershipRole, number> = {
  editor: 1,
  owner: 2,
}

export async function getSession() {
  return auth.api.getSession({
    headers: getRequestHeaders(),
  })
}

export async function requireUser() {
  const session = await getSession()
  if (!session) {
    throw redirect({ href: '/login' })
  }
  return session
}

export async function requireAgencyAdmin() {
  const session = await requireUser()
  if (!session.user.isAgencyAdmin) {
    throw new Response('Forbidden', { status: 403 })
  }
  return session
}

export async function requireOrgMember(
  orgId: string,
  role?: MembershipRole,
) {
  const session = await requireUser()
  if (session.user.isAgencyAdmin) {
    return session
  }

  const [member] = await db
    .select()
    .from(membership)
    .where(
      and(
        eq(membership.userId, session.user.id),
        eq(membership.organizationId, orgId),
      ),
    )
    .limit(1)

  if (!member) {
    throw new Response('Forbidden', { status: 403 })
  }

  if (role && roleRank[member.role] < roleRank[role]) {
    throw new Response('Forbidden', { status: 403 })
  }

  return session
}
