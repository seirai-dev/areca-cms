import { describe, expect, it, vi } from 'vitest'

import { renderGranted, renderRevoked } from './templates/agency-admin.ts'
import { MAIL_LOCALES } from './types.ts'
import type { MailBrand } from './types.ts'

vi.mock('#/env', () => ({ env: { APP_URL: 'https://cms.test' } }))
vi.mock('./templates/shared.ts', () => ({
  loadRecipient: async () => ({ name: 'Ada', email: 'ada@example.test' }),
  formatUtc: () => '22 Oct 2026, 12:00 UTC',
}))

const brand: MailBrand = {
  appName: 'Acme CMS',
  accentColor: null,
  font: 'inter',
  emailFromName: null,
  logoUrl: null,
}
const params = {
  userId: 'u1',
  at: '2026-10-22T12:00:00.000Z',
  actorName: 'Owen',
}

describe('agency admin notices', () => {
  it.each(MAIL_LOCALES)('renders a grant notice in %s', async (locale) => {
    const mail = await renderGranted(params, { locale, brand })
    expect(mail.html).toContain(`lang="${locale}"`)
    expect(mail.html).toContain('Owen')
    expect(mail.html).toContain('22 Oct 2026, 12:00 UTC')
    expect(mail.html).toContain('href="https://cms.test/account"')
    expect(mail.secrets).toEqual([])
  })

  it.each(MAIL_LOCALES)('renders a revoke notice in %s', async (locale) => {
    const mail = await renderRevoked(params, { locale, brand })
    expect(mail.html).toContain('Owen')
    expect(mail.text).toContain('22 Oct 2026, 12:00 UTC')
  })

  it('gives grant and revoke different subjects in every locale', async () => {
    for (const locale of MAIL_LOCALES) {
      const granted = await renderGranted(params, { locale, brand })
      const revoked = await renderRevoked(params, { locale, brand })
      expect(granted.subject).not.toBe(revoked.subject)
    }
  })
})
