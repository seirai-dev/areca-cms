import { describe, expect, it } from 'vitest'

import { sampleRichText } from '#/server/content/test-utils'
import type { Field } from '#/lib/types'

import { entryCoverage } from './entry-coverage.ts'
import { coverageLabel } from './locale-chips.tsx'

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'body', label: 'Body', type: 'richtext', required: true },
  { key: 'heroImage', label: 'Hero', type: 'image' },
]
const languages = { main: 'nl', all: ['nl', 'en', 'fr'] }

describe('entryCoverage', () => {
  it('reports complete, partial and empty per language, in site order', () => {
    const data = {
      title: 'Titel',
      body: sampleRichText,
      $i18n: {
        en: { title: 'Title' },
      },
    }
    const coverage = entryCoverage(data, fields, languages, ['en'])
    expect(coverage.map((item) => [item.locale, item.state])).toEqual([
      ['nl', 'complete'],
      ['en', 'partial'],
      ['fr', 'empty'],
    ])
  })

  it('counts missing required translatable fields', () => {
    const coverage = entryCoverage({ title: 'Titel' }, fields, languages, [])
    const nl = coverage.find((item) => item.locale === 'nl')
    expect(nl?.state).toBe('partial')
    expect(nl?.missing).toBe(1)
  })

  it('marks the main language and the required languages as required', () => {
    const coverage = entryCoverage({}, fields, languages, ['en'])
    expect(coverage.map((item) => [item.locale, item.required])).toEqual([
      ['nl', true],
      ['en', true],
      ['fr', false],
    ])
  })

  it('treats a shared field as complete in every language', () => {
    const shared: Field[] = [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'salary', label: 'Salary', type: 'number', required: true },
    ]
    const coverage = entryCoverage(
      { title: 'Hi', salary: 4000, $i18n: { en: { title: 'Hello' } } },
      shared,
      languages,
      [],
    )
    expect(coverage.map((item) => item.state)).toEqual([
      'complete',
      'complete',
      'empty',
    ])
  })
})

describe('coverageLabel', () => {
  it('names the language in English with the count', () => {
    expect(
      coverageLabel({
        locale: 'en',
        isMain: false,
        required: true,
        state: 'partial',
        missing: 2,
      }),
    ).toBe('English: 2 missing')
    expect(
      coverageLabel({
        locale: 'en',
        isMain: false,
        required: false,
        state: 'empty',
        missing: 2,
      }),
    ).toBe('English: not started')
    expect(
      coverageLabel({
        locale: 'nl',
        isMain: true,
        required: true,
        state: 'complete',
        missing: 0,
      }),
    ).toBe('Dutch: complete')
  })
})
