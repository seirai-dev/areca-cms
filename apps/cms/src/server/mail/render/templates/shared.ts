/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { user } from '#/db/schema'
import { m } from '#/paraglide/messages'

import { MailRenderError } from '../types.ts'
import type { Executor, MailLocale } from '../types.ts'

export type Recipient = {
  id: string
  name: string
  email: string
  emailVerified: boolean
}

/** Reads the account an email is about. Fails when it no longer exists. */
export async function loadRecipient(
  userId: unknown,
  connection?: Executor,
): Promise<Recipient> {
  const [row] = await (connection ?? db)
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    })
    .from(user)
    .where(eq(user.id, String(userId ?? '')))
    .limit(1)
  if (!row) throw new MailRenderError('the account no longer exists')
  return row
}

/** "Microsoft or Google", in the recipient's language. */
export function listOr(items: string[], locale: MailLocale) {
  return new Intl.ListFormat(locale, {
    style: 'long',
    type: 'disjunction',
  }).format(items)
}

/** Date and time in UTC, so every recipient reads the same moment. */
export function formatUtc(value: unknown, locale: MailLocale) {
  const date = new Date(String(value ?? ''))
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date)
}

/** Owner or editor, as the people screens label them. Other values pass through. */
export function roleLabel(role: string, locale: MailLocale) {
  if (role === 'owner') return m.people_role_owner({}, { locale })
  if (role === 'editor') return m.people_role_editor({}, { locale })
  return role
}
