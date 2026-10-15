import { describe, expect, it } from 'vitest'

import type { Field } from '#/lib/types'

import { validateEntryData } from './validation.ts'

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'body', label: 'Body', type: 'textarea' },
  { key: 'salary', label: 'Salary', type: 'number' },
]

describe('validateEntryData with languages', () => {
  it('accepts $i18n and $locale on a write', () => {
    const result = validateEntryData(
      fields,
      {
        title: 'Hallo',
        salary: 4000,
        $locale: 'nl',
        $i18n: { en: { title: 'Hello', body: 'Text', $slug: 'hello' } },
      },
      { mode: 'partial', write: true },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.$i18n).toEqual({
      en: { title: 'Hello', body: 'Text', $slug: 'hello' },
    })
    expect(result.data.$locale).toBe('nl')
  })

  it('still rejects unknown top-level keys on a write', () => {
    const result = validateEntryData(
      fields,
      { title: 'x', bogus: 1 },
      { mode: 'partial', write: true },
    )
    expect(result.ok).toBe(false)
  })

  it('rejects a translatable value of the wrong type in a language slot', () => {
    const result = validateEntryData(
      fields,
      { title: 'Hallo', $i18n: { en: { title: 5 } } },
      { mode: 'partial', write: true },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((e) => e.path)).toContain('$i18n.en.title')
  })

  it('rejects a shared field inside a language slot', () => {
    const result = validateEntryData(
      fields,
      { $i18n: { en: { salary: 10 } } },
      { mode: 'partial', write: true },
    )
    expect(result.ok).toBe(false)
  })

  it('does not require translatable fields in a language slot', () => {
    const result = validateEntryData(
      fields,
      { title: 'Hallo', $i18n: { en: { title: '', body: '' } } },
      { mode: 'partial', write: true },
    )
    expect(result.ok).toBe(true)
  })

  it('validates a per-language $seo and $slug format', () => {
    const badSlug = validateEntryData(
      fields,
      { $i18n: { en: { $slug: 'Not Valid' } } },
      { mode: 'partial', write: true },
    )
    expect(badSlug.ok).toBe(false)
    const badSeo = validateEntryData(
      fields,
      { $i18n: { en: { $seo: { title: 42 } } } },
      { mode: 'partial', write: true },
    )
    expect(badSeo.ok).toBe(false)
  })

  it('rejects an invalid language code as a slot key', () => {
    const result = validateEntryData(
      fields,
      { title: 'Hallo', $i18n: { 'not a tag!!': { title: 'x' } } },
      { mode: 'partial', write: true },
    )
    expect(result.ok).toBe(false)
  })

  it('rejects an invalid $locale value', () => {
    const result = validateEntryData(
      fields,
      { title: 'Hallo', $locale: 'not a tag!!' },
      { mode: 'partial', write: true },
    )
    expect(result.ok).toBe(false)
  })
})
