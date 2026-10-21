/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Drizzle row arrays can be empty at runtime, so lookups stay defensive. */
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { user } from '#/db/schema'
import { EMPTY_LOGIN_TAGLINES, loginTaglineFor } from '#/lib/branding'

import { getBranding, resetBranding, updateBranding } from './branding'

async function createActor() {
  const [actor] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: 'Branding admin',
      email: `branding-${crypto.randomUUID()}@test.local`,
      emailVerified: true,
    })
    .returning({ id: user.id })
  if (!actor) throw new Error('actor insert failed')
  return actor.id
}

describe('sign-in tagline persistence', () => {
  it('saves per-language taglines and reads them back', async () => {
    const actor = await createActor()
    try {
      const saved = await updateBranding(
        {
          loginTagline: {
            en: '  Your studio, online  ',
            nl: '',
            tr: 'Web siteniz, sizin elinizde',
          },
        },
        actor,
      )

      expect(saved.loginTagline).toEqual({
        en: 'Your studio, online',
        nl: null,
        tr: 'Web siteniz, sizin elinizde',
      })
      expect(saved.customized).toBe(true)

      const loaded = await getBranding()
      expect(loaded.loginTagline).toEqual(saved.loginTagline)
      expect(loginTaglineFor(loaded, 'en')).toBe('Your studio, online')
      expect(loginTaglineFor(loaded, 'nl')).toBeNull()
    } finally {
      await resetBranding(actor)
    }
  })

  it('clears a tagline when every language is emptied', async () => {
    const actor = await createActor()
    try {
      await updateBranding({ loginTagline: { en: 'Temporary' } }, actor)
      const cleared = await updateBranding(
        { loginTagline: { en: '  ', nl: null, tr: null } },
        actor,
      )

      expect(cleared.loginTagline).toEqual(EMPTY_LOGIN_TAGLINES)
      expect((await getBranding()).loginTagline).toEqual(EMPTY_LOGIN_TAGLINES)
    } finally {
      await resetBranding(actor)
    }
  })
})
