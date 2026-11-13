import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db } from '#/db'
import { organization, user } from '#/db/schema'
import { m } from '#/paraglide/messages'
import { getBranding } from '#/server/admin/branding'
import { encryptSecret } from '#/server/security/secret-encryption'
import { secretsEncryptionKey } from '#/server/security/secrets-key'

import type { MailTemplate } from '../outbox.ts'

import { MailRenderError, renderTemplate } from './index.ts'
import { MAIL_LOCALES } from './types.ts'
import type { MailLocale } from './types.ts'

const hasDb = Boolean(process.env.DATABASE_URL)

async function fixture(options: { verified: boolean }) {
  const suffix = crypto.randomUUID()
  const org = (
    await db
      .insert(organization)
      .values({ name: `Northbound ${suffix}`, slug: `tpl-${suffix}` })
      .returning()
  ).at(0)
  const person = (
    await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: 'Ada Recipient',
        email: `ada-${suffix}@test.local`,
        emailVerified: options.verified,
        locale: 'en',
      })
      .returning()
  ).at(0)
  if (!org || !person) throw new Error('fixture failed')
  return {
    org,
    person,
    cleanup: async () => {
      await db.delete(user).where(eq(user.id, person.id))
      await db.delete(organization).where(eq(organization.id, org.id))
    },
  }
}

async function brand() {
  return { ...(await getBranding()), appName: 'Acme CMS' }
}

describe.skipIf(!hasDb)('account email templates', () => {
  it.each(MAIL_LOCALES)(
    'render every template in %s with branding',
    async (locale) => {
      const unverified = await fixture({ verified: false })
      try {
        const options = { locale, brand: await brand() }
        const cases: Array<[MailTemplate, Record<string, unknown>]> = [
          [
            'password_reset',
            { userId: unverified.person.id, token: 'tok-abc' },
          ],
          [
            'password_reset_sso',
            { userId: unverified.person.id, providers: ['Microsoft'] },
          ],
          ['verify_email', { userId: unverified.person.id }],
          [
            'password_changed',
            { userId: unverified.person.id, at: '2026-10-21T10:00:00Z' },
          ],
          [
            'two_factor_enabled',
            { userId: unverified.person.id, at: '2026-10-21T10:00:00Z' },
          ],
          [
            'two_factor_disabled',
            { userId: unverified.person.id, at: '2026-10-21T10:00:00Z' },
          ],
          [
            'membership_removed',
            {
              userId: unverified.person.id,
              orgName: 'Northbound',
              actorName: 'Ben Admin',
            },
          ],
          [
            'membership_role_changed',
            {
              userId: unverified.person.id,
              organizationId: unverified.org.id,
              role: 'owner',
              previousRole: 'editor',
            },
          ],
        ]
        for (const [template, params] of cases) {
          const mail = await renderTemplate(template, params, options)
          expect(mail.subject, template).not.toBe('')
          expect(mail.html, template).toContain(`lang="${locale}"`)
          expect(mail.html, template).toContain('Acme CMS')
          expect(mail.text, template).toContain('Acme CMS')
        }
      } finally {
        await unverified.cleanup()
      }
    },
  )

  it.each([
    'password_reset',
    'password_reset_sso',
    'verify_email',
    'password_changed',
    'two_factor_enabled',
    'two_factor_disabled',
    'membership_removed',
    'membership_role_changed',
  ] as const)('%s has its own subject in every locale', async (template) => {
    const fx = await fixture({ verified: false })
    try {
      const params: Record<string, unknown> = {
        userId: fx.person.id,
        token: 'tok-abc',
        providers: ['Microsoft'],
        at: '2026-10-21T10:00:00Z',
        orgName: 'Northbound',
        actorName: 'Ben',
        organizationId: fx.org.id,
        role: 'owner',
        previousRole: 'editor',
      }
      const subjects = await Promise.all(
        MAIL_LOCALES.map(async (locale) => {
          const mail = await renderTemplate(template, params, {
            locale,
            brand: await brand(),
          })
          return mail.subject
        }),
      )
      expect(new Set(subjects).size).toBe(MAIL_LOCALES.length)
    } finally {
      await fx.cleanup()
    }
  })

  it.each(MAIL_LOCALES)('uses translated role labels in %s', async (locale) => {
    const fx = await fixture({ verified: false })
    try {
      const mail = await renderTemplate(
        'membership_role_changed',
        {
          userId: fx.person.id,
          organizationId: fx.org.id,
          role: 'owner',
          previousRole: 'editor',
        },
        { locale, brand: await brand() },
      )
      expect(mail.text).toContain(m.people_role_owner({}, { locale }))
      expect(mail.text).toContain(m.people_role_editor({}, { locale }))
    } finally {
      await fx.cleanup()
    }
  })

  it('links a reset token and lists it as a secret', async () => {
    const fx = await fixture({ verified: false })
    try {
      const mail = await renderTemplate(
        'password_reset',
        { userId: fx.person.id, token: 'tok-abc' },
        { locale: 'en', brand: await brand() },
      )
      expect(mail.html).toContain('/reset-password?token=tok-abc')
      expect(mail.secrets).toEqual(
        expect.arrayContaining(['tok-abc', expect.stringContaining('tok-abc')]),
      )
    } finally {
      await fx.cleanup()
    }
  })

  it('decrypts a stored reset token when the outbox kept one', async () => {
    const key = secretsEncryptionKey()
    if (!key) throw new Error('test key missing')
    const fx = await fixture({ verified: false })
    try {
      const encryptedToken = encryptSecret(
        'tok-enc',
        key,
        'email-outbox:params',
      )
      const mail = await renderTemplate(
        'password_reset',
        { userId: fx.person.id, encryptedToken },
        { locale: 'nl', brand: await brand() },
      )
      expect(mail.html).toContain('/reset-password?token=tok-enc')
    } finally {
      await fx.cleanup()
    }
  })

  it('refuses a reset without any token', async () => {
    const fx = await fixture({ verified: false })
    try {
      await expect(
        renderTemplate(
          'password_reset',
          { userId: fx.person.id },
          { locale: 'en', brand: await brand() },
        ),
      ).rejects.toBeInstanceOf(MailRenderError)
    } finally {
      await fx.cleanup()
    }
  })

  it('links a verification email for a day, and refuses verified accounts', async () => {
    const unverified = await fixture({ verified: false })
    const verified = await fixture({ verified: true })
    try {
      const mail = await renderTemplate(
        'verify_email',
        { userId: unverified.person.id },
        { locale: 'tr', brand: await brand() },
      )
      expect(mail.html).toContain('/api/auth/verify-email?token=')
      expect(mail.secrets.length).toBe(2)

      await expect(
        renderTemplate(
          'verify_email',
          { userId: verified.person.id },
          { locale: 'tr', brand: await brand() },
        ),
      ).rejects.toBeInstanceOf(MailRenderError)
    } finally {
      await unverified.cleanup()
      await verified.cleanup()
    }
  })

  it('names the sign-in providers in the SSO email', async () => {
    const fx = await fixture({ verified: false })
    try {
      const locale: MailLocale = 'en'
      const mail = await renderTemplate(
        'password_reset_sso',
        { userId: fx.person.id, providers: ['Microsoft', 'Google'] },
        { locale, brand: await brand() },
      )
      expect(mail.subject).toContain('Microsoft')
      expect(mail.subject).toContain('Google')
      expect(mail.secrets).toEqual([])

      await expect(
        renderTemplate(
          'password_reset_sso',
          { userId: fx.person.id, providers: [] },
          { locale, brand: await brand() },
        ),
      ).rejects.toBeInstanceOf(MailRenderError)
    } finally {
      await fx.cleanup()
    }
  })

  it('refuses a template whose recipient no longer exists', async () => {
    await expect(
      renderTemplate(
        'password_changed',
        { userId: 'no-such-user', at: '2026-10-21T10:00:00Z' },
        { locale: 'en', brand: await brand() },
      ),
    ).rejects.toBeInstanceOf(MailRenderError)
  })

  it('refuses a role-changed email for an organization that was deleted', async () => {
    const fx = await fixture({ verified: false })
    try {
      await db.delete(organization).where(eq(organization.id, fx.org.id))
      await expect(
        renderTemplate(
          'membership_role_changed',
          {
            userId: fx.person.id,
            organizationId: fx.org.id,
            role: 'owner',
            previousRole: 'editor',
          },
          { locale: 'en', brand: await brand() },
        ),
      ).rejects.toBeInstanceOf(MailRenderError)
    } finally {
      await fx.cleanup()
    }
  })
})
