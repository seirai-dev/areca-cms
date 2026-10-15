import { describe, expect, it } from 'vitest'

import { SEO_KEY } from '#/lib/seo'
import type { EntryData, Field } from '#/lib/types'

import {
  afterSave,
  emptyTargetKeys,
  fieldAttributeFor,
  fieldsToTranslate,
  translatableSourceKeys,
  translationPatch,
} from './translate-plan'

const FIELDS: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'body', label: 'Body', type: 'richtext', translatable: true },
  { key: 'summary', label: 'Summary', type: 'textarea' },
  { key: 'salary', label: 'Salary', type: 'number' },
  { key: 'location', label: 'Location', type: 'text', translatable: false },
  { key: 'link', label: 'Link', type: 'url' },
]

const richtext = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('emptyTargetKeys', () => {
  it('lists translatable text, textarea and richtext keys that are empty in the target', () => {
    const target: EntryData = { title: 'Backend developer', body: null }
    expect(
      emptyTargetKeys({ fields: FIELDS, target, seoEnabled: false }),
    ).toEqual(['body', 'summary'])
  })

  it('treats whitespace-only text as empty and a text-only rich text document as filled', () => {
    const target: EntryData = { title: '   ', body: richtext('Hallo') }
    expect(
      emptyTargetKeys({ fields: FIELDS, target, seoEnabled: false }),
    ).toEqual(['title', 'summary'])
  })

  it('skips shared fields and types the server does not translate', () => {
    const keys = emptyTargetKeys({
      fields: FIELDS,
      target: {},
      seoEnabled: false,
    })
    expect(keys).not.toContain('salary')
    expect(keys).not.toContain('location')
    expect(keys).not.toContain('link')
  })

  it('adds empty $seo text values only when SEO is enabled', () => {
    const target: EntryData = { [SEO_KEY]: { title: 'Titel' } }
    const on = emptyTargetKeys({ fields: [], target, seoEnabled: true })
    expect(on).toEqual([
      'seo.description',
      'seo.focusKeyphrase',
      'seo.ogTitle',
      'seo.ogDescription',
      'seo.summary',
    ])
    expect(emptyTargetKeys({ fields: [], target, seoEnabled: false })).toEqual(
      [],
    )
  })
})

describe('fieldsToTranslate', () => {
  it('sends only keys that are empty in the target and filled in the source', () => {
    const source: EntryData = {
      title: 'Backend developer',
      body: richtext('We zoeken'),
      summary: '',
      [SEO_KEY]: { title: 'Backend developer', description: 'Vacature' },
    }
    const target: EntryData = { title: 'Filled already' }
    expect(
      fieldsToTranslate({ fields: FIELDS, source, target, seoEnabled: true }),
    ).toEqual(['body', 'seo.title', 'seo.description'])
  })

  it('never includes a key the target already has, even when the source has text', () => {
    const source: EntryData = { title: 'A', body: richtext('B') }
    const target: EntryData = { title: 'Al', body: richtext('Al') }
    expect(
      fieldsToTranslate({ fields: FIELDS, source, target, seoEnabled: false }),
    ).toEqual([])
  })
})

describe('translationPatch', () => {
  it('writes values as-is and merges $seo over the target SEO', () => {
    const target: EntryData = {
      [SEO_KEY]: { title: 'Oud', focusKeyphrase: 'vacature' },
    }
    const result = {
      values: { title: 'Backend developer' },
      seo: { description: 'Job opening' },
    }
    const { patch, applied } = translationPatch(target, result)
    expect(patch).toEqual({
      title: 'Backend developer',
      [SEO_KEY]: {
        title: 'Oud',
        focusKeyphrase: 'vacature',
        description: 'Job opening',
      },
    })
    expect(applied).toEqual(['title', 'seo.description'])
  })

  it('applies nothing for an empty result', () => {
    const { patch, applied } = translationPatch({}, { values: {} })
    expect(patch).toEqual({})
    expect(applied).toEqual([])
  })

  it('maps seo keys to their rendered data-field', () => {
    expect(fieldAttributeFor('seo.title')).toBe(`${SEO_KEY}.title`)
    expect(fieldAttributeFor('body')).toBe('body')
  })
})

describe('translatableSourceKeys', () => {
  it('lists filled translatable source fields and $seo text, never shared or blank ones', () => {
    const source: EntryData = {
      title: 'Backend developer',
      body: '',
      salary: 3800,
      [SEO_KEY]: { description: 'Vacature' },
    }
    expect(
      translatableSourceKeys({ fields: FIELDS, source, seoEnabled: true }),
    ).toEqual(['title', 'seo.description'])
  })

  it('is empty when the main language has no text, so the language action is disabled', () => {
    expect(
      translatableSourceKeys({ fields: FIELDS, source: {}, seoEnabled: true }),
    ).toEqual([])
  })
})

describe('afterSave', () => {
  it('runs the continuation only after a successful save', async () => {
    const calls: string[] = []
    const outcome = await afterSave(
      async () => {
        calls.push('save')
        return 'saved'
      },
      () => calls.push('translate'),
    )
    expect(outcome).toBe('saved')
    expect(calls).toEqual(['save', 'translate'])
  })

  it('aborts and returns the failure when the save fails or is blocked', async () => {
    for (const failure of ['failed', 'blocked'] as const) {
      let ran = false
      const outcome = await afterSave(
        async () => failure,
        () => {
          ran = true
        },
      )
      expect(outcome).toBe(failure)
      expect(ran).toBe(false)
    }
  })
})
