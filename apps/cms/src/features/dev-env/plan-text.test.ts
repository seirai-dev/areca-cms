import { describe, expect, it } from 'vitest'

import type { DevEnvWarning } from '#/lib/dev-env'
import { m } from '#/paraglide/messages'

import {
  detailText,
  planTitleText,
  scheduledReasonText,
  schemaActionText,
  slugTakenText,
  warningText,
} from './plan-text'

describe('warningText', () => {
  it('renders each code from its params, not from the English message', () => {
    const cases: DevEnvWarning[] = [
      {
        code: 'section-entry-missing',
        params: { slug: 'footer' },
        message: 'English only',
      },
      {
        code: 'collection-missing',
        params: { collectionKey: 'articles' },
        message: 'English only',
      },
      {
        code: 'reference-cleared',
        params: { field: 'author', devTargetId: 'd1' },
        message: 'English only',
      },
      {
        code: 'reference-cleared',
        params: { field: 'author', locale: 'nl', devTargetId: 'd1' },
        message: 'English only',
      },
      {
        code: 'ready-not-pushed',
        params: { details: 'title is required' },
        message: 'English only',
      },
      {
        code: 'ready-not-copied',
        params: { details: 'title is required' },
        message: 'English only',
      },
    ]
    for (const warning of cases) {
      const text = warningText(warning)
      expect(text).not.toBe('English only')
      expect(text.length).toBeGreaterThan(0)
    }
    expect(warningText(cases[0])).toContain('footer')
    expect(warningText(cases[1])).toContain('articles')
    expect(warningText(cases[2])).toContain('author')
    expect(warningText(cases[3])).toContain('nl')
    expect(warningText(cases[4])).toContain('title is required')
    expect(warningText(cases[5])).toContain('title is required')
  })
})

describe('slugTakenText', () => {
  it('names the URL and the entry that holds it', () => {
    const text = slugTakenText({ slug: 'contact', collidesWith: 'Contact' })
    expect(text).toContain('"contact"')
    expect(text).toContain('"Contact"')
  })

  it('names the language of a localized URL', () => {
    const text = slugTakenText({
      locale: 'nl',
      slug: 'contact',
      collidesWith: 'Contact',
    })
    expect(text).toContain('"contact"')
    expect(text).toContain('"Contact"')
    // The language name comes from the UI language (the tests run in English).
    expect(text).toContain('Dutch')
  })
})

describe('detailText and planTitleText', () => {
  it('names the kept fields and the archive counts', () => {
    expect(detailText({ kind: 'keeps', fields: ['excerpt'] })).toContain(
      "'excerpt'",
    )
    const archives = detailText({ kind: 'archives', values: 4, entries: 2 })
    expect(archives).toContain('4')
    expect(archives).toContain('2')
    expect(
      detailText({ kind: 'archives', values: null, entries: 3 }),
    ).toContain('3')
  })

  it('names the scheduled entries in the reason, once', () => {
    expect(scheduledReasonText(['Spring menu'])).toBe(
      'Scheduled in production: Spring menu. Resolve it first.',
    )
    expect(scheduledReasonText([])).toBe(
      'Scheduled in production. Resolve it first.',
    )
  })

  it('translates the site languages title', () => {
    expect(planTitleText('site-languages')).toBe(m.dev_push_languages_title())
  })
})

describe('schemaActionText', () => {
  it('names what a schema row does', () => {
    expect(schemaActionText({ kind: 'add-collection' })).toBe('Add collection')
    expect(schemaActionText({ kind: 'remove-collection' })).toBe(
      'Remove collection',
    )
    expect(schemaActionText({ kind: 'change-collection' })).toBe(
      'Change collection',
    )
  })

  it('names the removed field, or the removed fields', () => {
    expect(
      schemaActionText({ kind: 'remove-fields', fields: ['excerpt'] }),
    ).toBe("Remove field 'excerpt'")
    expect(
      schemaActionText({ kind: 'remove-fields', fields: ['excerpt', 'body'] }),
    ).toBe("Remove fields 'excerpt', 'body'")
  })
})
