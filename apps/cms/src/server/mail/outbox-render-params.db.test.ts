/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { emailOutbox, user } from '#/db/schema'

import { enqueueEmail, sendNow } from './outbox.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

async function rowOf(id: string) {
  const [row] = await db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.id, id))
    .limit(1)
  if (!row) throw new Error(`outbox row ${id} missing`)
  return row
}

describe.skipIf(!hasDb)('outbox render params', () => {
  it('uses renderParams for the subject and the send only, never for the stored params', async () => {
    const [person] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: 'Render Params',
        email: `render-${crypto.randomUUID()}@areca.local`,
        locale: 'en',
      })
      .returning()
    if (!person) throw new Error('fixture failed')
    const token = 'render-only-token'

    const { id } = await enqueueEmail({
      kind: 'password_reset',
      template: 'password_reset',
      to: person.email,
      params: { userId: person.id },
      renderParams: { token },
      locale: 'en',
      userId: person.id,
    })
    const queued = await rowOf(id)
    expect(queued.subject).toBe('Reset your password')
    expect(JSON.stringify(queued)).not.toContain(token)

    // The row has no token of its own, so a send without one fails for good.
    await expect(sendNow(id)).resolves.toMatchObject({ status: 'failed' })
    expect(await rowOf(id)).toMatchObject({ status: 'failed' })

    const { id: second } = await enqueueEmail({
      kind: 'password_reset',
      template: 'password_reset',
      to: person.email,
      params: { userId: person.id },
      locale: 'en',
      userId: person.id,
    })
    // Without renderParams the subject falls back to the kind.
    expect((await rowOf(second)).subject).toBe('password_reset')

    await expect(
      sendNow(second, { renderParams: { token } }),
    ).resolves.toMatchObject({ status: 'sent' })
    expect(JSON.stringify(await rowOf(second))).not.toContain(token)

    await db.delete(emailOutbox).where(eq(emailOutbox.userId, person.id))
    await db.delete(user).where(eq(user.id, person.id))
  })
})
