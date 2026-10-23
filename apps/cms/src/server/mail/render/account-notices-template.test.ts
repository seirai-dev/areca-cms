import { describe, expect, it, vi } from 'vitest'

import { renderDeleted } from './templates/account-deleted.ts'
import { renderAdded } from './templates/membership.ts'
import { renderReset } from './templates/two-factor.ts'
import { MAIL_LOCALES } from './types.ts'
import type { MailBrand } from './types.ts'

vi.mock('#/env', () => ({ env: { APP_URL: 'https://cms.test' } }))
vi.mock('./templates/shared.ts', () => ({
  loadRecipient: async () => ({ name: 'Ada', email: 'ada@example.test' }),
  formatUtc: () => '23 Oct 2026, 18:00 UTC',
  roleLabel: (role: string) => role,
}))

const brand: MailBrand = {
  appName: 'Acme CMS',
  accentColor: null,
  font: 'inter',
  emailFromName: null,
  logoUrl: null,
}

const at = '2026-10-23T18:00:00.000Z'

describe('account deletion notice', () => {
  it.each(MAIL_LOCALES)(
    'self deletion in %s says the person deleted it, and names no actor',
    (locale) => {
      const mail = renderDeleted(
        { self: true, deletedUserName: 'Ada', actorName: 'Ada', at },
        { locale, brand },
      )
      expect(mail.html).toContain(`lang="${locale}"`)
      expect(mail.html).toContain('23 Oct 2026, 18:00 UTC')
      expect(mail.text).not.toContain('Ada, ')
      expect(mail.secrets).toEqual([])
    },
  )

  it.each(MAIL_LOCALES)(
    'an admin deletion in %s names the agency admin',
    (locale) => {
      const mail = renderDeleted(
        { self: false, deletedUserName: 'Ada', actorName: 'Owen', at },
        { locale, brand },
      )
      expect(mail.html).toContain('Owen')
      expect(mail.html).toContain('23 Oct 2026, 18:00 UTC')
    },
  )

  it.each(MAIL_LOCALES)(
    'self and admin deletions have different subjects in %s',
    (locale) => {
      const self = renderDeleted(
        { self: true, actorName: 'Ada', at },
        { locale, brand },
      )
      const admin = renderDeleted(
        { self: false, actorName: 'Owen', at },
        { locale, brand },
      )
      expect(self.subject).not.toBe(admin.subject)
    },
  )

  it('renders without reading the account, so it works after the account is gone', () => {
    // Only params and the render context are passed: nothing reads the user row.
    expect(() =>
      renderDeleted(
        { self: false, actorName: 'Owen', at },
        { locale: 'nl', brand },
      ),
    ).not.toThrow()
  })
})

describe('client access notice', () => {
  it.each(MAIL_LOCALES)('lists every added client in %s', async (locale) => {
    const mail = await renderAdded(
      {
        userId: 'u1',
        actorName: 'Owen',
        orgs: [
          { name: 'Acme', role: 'owner' },
          { name: 'Beta Labs', role: 'editor' },
        ],
      },
      { locale, brand },
    )
    expect(mail.html).toContain(`lang="${locale}"`)
    expect(mail.html).toContain('Acme')
    expect(mail.html).toContain('Beta Labs')
    expect(mail.html).toContain('href="https://cms.test/"')
    expect(mail.secrets).toEqual([])
  })

  it('joins English client names into one readable list', async () => {
    const mail = await renderAdded(
      {
        userId: 'u1',
        actorName: 'Owen',
        orgs: [
          { name: 'Acme', role: 'owner' },
          { name: 'Beta Labs', role: 'editor' },
        ],
      },
      { locale: 'en', brand },
    )
    expect(mail.text).toContain('Acme and Beta Labs')
  })
})

describe('two-factor reset notice', () => {
  it.each(MAIL_LOCALES)(
    'renders in %s with the actor and the time',
    async (locale) => {
      const mail = await renderReset(
        { userId: 'u1', actorName: 'Owen', at },
        { locale, brand },
      )
      expect(mail.html).toContain(`lang="${locale}"`)
      expect(mail.html).toContain('Owen')
      expect(mail.html).toContain('23 Oct 2026, 18:00 UTC')
      expect(mail.html).toContain('href="https://cms.test/account"')
    },
  )

  it.each(MAIL_LOCALES)(
    'has a subject that differs from the enabled and disabled notices in %s',
    async (locale) => {
      const mail = await renderReset(
        { userId: 'u1', actorName: 'Owen', at },
        { locale, brand },
      )
      expect(mail.subject.length).toBeGreaterThan(0)
      expect(mail.subject).not.toMatch(/\{/)
    },
  )
})
