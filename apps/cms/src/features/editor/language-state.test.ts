import { describe, expect, it } from 'vitest'

import { writeLocale } from '#/lib/content-locale'
import { languageEndonym } from '#/lib/site-languages'
import type { EntryData, Field } from '#/lib/types'

import {
  blockersFor,
  editorLanguages,
  localeContext,
  languageStateKey,
  localeSummaries,
  requiredLocales,
  ringFraction,
  ringState,
  requiredTranslatableFields,
} from './language-state'

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
  { key: 'salary', label: 'Salary', type: 'number', required: true },
  { key: 'note', label: 'Note', type: 'text' },
]
const languages = { main: 'nl', all: ['nl', 'en', 'fr'] }
const ctx = localeContext(languages, fields)
const richBody = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hallo' }] }],
}

describe('editorLanguages', () => {
  it('is null for single-language sites', () => {
    expect(editorLanguages(null)).toBeNull()
    expect(editorLanguages(undefined)).toBeNull()
    expect(editorLanguages({ main: 'nl', all: ['nl'] })).toBeNull()
  })

  it('keeps multi-language sites and makes sure main is listed', () => {
    expect(editorLanguages({ main: 'nl', all: ['en', 'fr'] })).toEqual({
      main: 'nl',
      all: ['nl', 'en', 'fr'],
    })
    expect(editorLanguages(languages)).toEqual(languages)
  })
})

describe('requiredLocales', () => {
  it('is main plus the required languages that exist, in site order', () => {
    expect(requiredLocales(languages, ['fr', 'de'])).toEqual(['nl', 'fr'])
    expect(requiredLocales(languages, [])).toEqual(['nl'])
  })
})

describe('ring fraction and state', () => {
  it('is filled required translatable fields over the total', () => {
    const data: EntryData = { title: 'Hallo' }
    const status = localeSummaries(data, ctx, ['nl'])[0].status
    expect(requiredTranslatableFields(fields).map((f) => f.key)).toEqual([
      'title',
      'body',
    ])
    expect(ringFraction(status, 2)).toBe(0.5)
  })

  it('is 1 when started and there is nothing required, else 0', () => {
    const started = { started: true, complete: true, missing: [] }
    const empty = { started: false, complete: true, missing: [] }
    expect(ringFraction(started, 0)).toBe(1)
    expect(ringFraction(empty, 0)).toBe(0)
  })

  it('maps started and complete to the three ring states', () => {
    expect(ringState({ started: false, complete: false, missing: ['x'] })).toBe(
      'empty',
    )
    expect(ringState({ started: true, complete: false, missing: ['x'] })).toBe(
      'partial',
    )
    expect(ringState({ started: true, complete: true, missing: [] })).toBe(
      'complete',
    )
  })
})

describe('localeSummaries', () => {
  it('flags required languages that are incomplete as warnings', () => {
    // Main (nl) has title and body; English has only the title.
    let data: EntryData = { title: 'Backend', body: richBody, salary: 4000 }
    data = writeLocale(data, 'en', { title: 'Backend developer' }, ctx)
    const summaries = localeSummaries(data, ctx, ['nl', 'en'])
    const [nl, en, fr] = summaries
    expect(nl).toMatchObject({ state: 'complete', warning: false })
    expect(en).toMatchObject({
      state: 'partial',
      warning: true,
      fraction: 0.5,
      missing: ['body'],
    })
    expect(fr).toMatchObject({
      state: 'empty',
      warning: false,
      required: false,
      fraction: 0,
    })
  })
})

describe('blockersFor', () => {
  it('lists required languages that are incomplete, with their missing keys', () => {
    const data: EntryData = { title: 'Backend', body: richBody }
    expect(blockersFor(data, ctx, ['nl', 'en'])).toEqual([
      { locale: 'en', missing: ['title', 'body'] },
    ])
  })

  it('is empty once every required language is complete', () => {
    let data: EntryData = { title: 'Backend', body: richBody }
    data = writeLocale(
      data,
      'en',
      { title: 'Backend developer', body: richBody },
      ctx,
    )
    expect(blockersFor(data, ctx, ['nl', 'en'])).toEqual([])
  })

  it('ignores optional languages', () => {
    const data: EntryData = { title: 'Backend', body: richBody }
    expect(blockersFor(data, ctx, ['nl'])).toEqual([])
  })
})

describe('languageEndonym', () => {
  it('gives the endonym, capitalised', () => {
    expect(languageEndonym('nl')).toBe('Nederlands')
    expect(languageEndonym('en')).toBe('English')
    expect(languageEndonym('fr')).toBe('Français')
  })

  it('falls back to the tag for an invalid tag', () => {
    expect(languageEndonym('zz-invalid-$$')).toBe('zz-invalid-$$')
  })
})

describe('languageStateKey', () => {
  it('describes each language for the status list', () => {
    const data: EntryData = { title: 'Backend', body: richBody }
    const [nl, en, fr] = localeSummaries(data, ctx, ['nl', 'en'])
    expect(languageStateKey(nl)).toBe('complete')
    expect(languageStateKey(en)).toBe('not_started')
    expect(languageStateKey(fr)).toBe('optional')
    const partial = writeLocale(data, 'en', { title: 'Backend developer' }, ctx)
    expect(
      languageStateKey(localeSummaries(partial, ctx, ['nl', 'en'])[1]),
    ).toBe('missing')
  })
})
