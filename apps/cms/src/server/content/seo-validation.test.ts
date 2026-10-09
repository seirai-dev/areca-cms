import { describe, expect, it } from 'vitest'

import { initialEntryData } from '#/lib/content/utils'
import type { Field } from '#/lib/types'

import { pickDeclaredFields, validateEntryData } from './validation.ts'

const fields: Field[] = [
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'title', label: 'Title', type: 'text', required: true },
]

describe('reserved $seo key', () => {
  it('is accepted on write and kept in the parsed data', () => {
    const result = validateEntryData(
      fields,
      { slug: 'a', title: 'A', $seo: { title: 'SEO A', noindex: true } },
      { mode: 'partial', write: true },
    )
    expect(result).toEqual({
      ok: true,
      data: { slug: 'a', title: 'A', $seo: { title: 'SEO A', noindex: true } },
    })
  })

  it('reports nested errors under $seo.*', () => {
    const result = validateEntryData(
      fields,
      { slug: 'a', title: 'A', $seo: { canonicalUrl: 'ftp://x', bogus: 1 } },
      { mode: 'partial', write: true },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    const paths = result.errors.map((error) => error.path)
    expect(paths).toContain('$seo.canonicalUrl')
    expect(paths.some((path) => path.startsWith('$seo'))).toBe(true)
  })

  it('combines field and SEO errors in one response', () => {
    const result = validateEntryData(
      fields,
      { slug: 'a', title: '', $seo: { schemaType: 'Nope' } },
      { mode: 'strict' },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    const paths = result.errors.map((error) => error.path)
    expect(paths).toEqual(expect.arrayContaining(['title', '$seo.schemaType']))
  })

  it('still rejects other unknown keys', () => {
    const result = validateEntryData(
      fields,
      { slug: 'a', title: 'A', seo: {} },
      { mode: 'partial', write: true },
    )
    expect(result.ok).toBe(false)
  })

  it('survives revision restore and editor hydration', () => {
    const stored = { slug: 'a', title: 'A', gone: 1, $seo: { title: 'T' } }
    expect(pickDeclaredFields(fields, stored)).toEqual({
      slug: 'a',
      title: 'A',
      $seo: { title: 'T' },
    })
    expect(initialEntryData(fields, stored)).toEqual({
      slug: 'a',
      title: 'A',
      $seo: { title: 'T' },
    })
  })
})
