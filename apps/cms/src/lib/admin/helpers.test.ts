import { describe, expect, it } from 'vitest'

import { formatAuditTarget, humanizeSlug } from './helpers'

describe('humanizeSlug', () => {
  it('turns a slug into sentence-case words', () => {
    expect(humanizeSlug('poster-series-for-the-autumn-campaign')).toBe(
      'Poster series for the autumn campaign',
    )
    expect(humanizeSlug('senior_designer')).toBe('Senior designer')
    expect(humanizeSlug('2026-plans')).toBe('2026 plans')
    expect(humanizeSlug('')).toBe('')
  })
})

describe('formatAuditTarget', () => {
  it('names entries by their humanised slug', () => {
    expect(
      formatAuditTarget({
        targetType: 'entry',
        targetId: 'e1',
        meta: { slug: 'spring-launch' },
      }),
    ).toBe('entry “Spring launch”')
  })

  it('falls back to emails, collection keys and names', () => {
    expect(
      formatAuditTarget({
        targetType: 'member',
        targetId: 'm1',
        meta: { email: 'ada@example.com' },
      }),
    ).toBe('member ada@example.com')
    expect(
      formatAuditTarget({
        targetType: 'site',
        targetId: 's1',
        siteName: 'Acme Website',
      }),
    ).toBe('Acme Website')
    expect(formatAuditTarget({ targetType: 'entry', targetId: 'e1' })).toBe(
      'entry',
    )
  })
})
