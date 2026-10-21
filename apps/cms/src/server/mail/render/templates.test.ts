import { describe, expect, it } from 'vitest'

import { buildInvitationMail } from './templates/invitation.ts'
import { render as renderTestEmail } from './templates/test.ts'
import { MAIL_LOCALES, mailLocale } from './types.ts'
import type { MailBrand } from './types.ts'

const brand: MailBrand = {
  appName: 'Acme CMS',
  accentColor: null,
  font: 'inter',
  emailFromName: null,
  logoUrl: null,
}

const invite = {
  orgName: 'Northbound',
  role: 'editor',
  expiresAt: new Date('2026-10-28T12:00:00Z'),
  token: 'tok-123',
}
const link = 'https://cms.test/invite/tok-123'

describe('mailLocale', () => {
  it('keeps supported locales and falls back to English', () => {
    expect(mailLocale('nl')).toBe('nl')
    expect(mailLocale('tr')).toBe('tr')
    expect(mailLocale('de')).toBe('en')
    expect(mailLocale(null)).toBe('en')
    expect(mailLocale(undefined)).toBe('en')
  })
})

describe('invitation email', () => {
  it.each(MAIL_LOCALES)(
    'renders in %s with the org, link and expiry',
    (locale) => {
      const mail = buildInvitationMail(invite, { link, locale, brand })
      expect(mail.subject).toContain('Northbound')
      expect(mail.html).toContain(`href="${link}"`)
      expect(mail.html).toContain(`lang="${locale}"`)
      expect(mail.text).toContain(link)
      expect(mail.preheader).toContain('Northbound')
    },
  )

  it('gives each locale its own subject', () => {
    const subjects = MAIL_LOCALES.map(
      (locale) => buildInvitationMail(invite, { link, locale, brand }).subject,
    )
    expect(new Set(subjects).size).toBe(MAIL_LOCALES.length)
  })

  it('lists the link and token as secrets so they can be scrubbed', () => {
    const mail = buildInvitationMail(invite, { link, locale: 'en', brand })
    expect(mail.secrets).toEqual(['tok-123', link])
  })

  it('escapes the organization name', () => {
    const mail = buildInvitationMail(
      { ...invite, orgName: '<img src=x onerror=alert(1)>' },
      { link, locale: 'en', brand },
    )
    expect(mail.html).not.toContain('<img src=x')
    expect(mail.html).toContain('&lt;img src=x')
  })
})

describe('test email', () => {
  it.each(MAIL_LOCALES)('renders in %s with the host', (locale) => {
    const mail = renderTestEmail(
      { host: 'smtp.example.com', sentBy: 'admin@example.com' },
      { locale, brand },
    )
    expect(mail.subject).toContain('Acme CMS')
    expect(mail.text).toContain('smtp.example.com')
    expect(mail.secrets).toEqual([])
  })

  it('gives each locale its own subject', () => {
    const subjects = MAIL_LOCALES.map(
      (locale) =>
        renderTestEmail({ host: 'h', sentBy: 's' }, { locale, brand }).subject,
    )
    expect(new Set(subjects).size).toBe(MAIL_LOCALES.length)
  })
})
