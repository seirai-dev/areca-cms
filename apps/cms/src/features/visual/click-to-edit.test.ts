import { describe, expect, it } from 'vitest'

import {
  buildTargets,
  isAwayFrom,
  isSelfOwner,
  markerForField,
  otherOwners,
  resolveFieldKey,
} from './click-to-edit'
import type { Marker } from './protocol'

const keys = ['title', 'hero_image', 'body', '$seo.title', '$seo.faq']

describe('resolveFieldKey', () => {
  it('matches a key exactly', () => {
    expect(resolveFieldKey('title', keys)).toBe('title')
    expect(resolveFieldKey('$seo.faq', keys)).toBe('$seo.faq')
  })

  it('matches the camelCase name a site sees', () => {
    expect(resolveFieldKey('heroImage', keys)).toBe('hero_image')
  })

  it('accepts seo.* for $seo.*', () => {
    expect(resolveFieldKey('seo.title', keys)).toBe('$seo.title')
  })

  it('returns null for an unknown key', () => {
    expect(resolveFieldKey('subtitle', keys)).toBeNull()
    expect(resolveFieldKey('$seo.noindex', keys)).toBeNull()
  })
})

describe('isSelfOwner', () => {
  const self = { entryId: 'e1', globalKey: null }

  it('treats no owner and the own entry id as the page itself', () => {
    expect(isSelfOwner(null, self)).toBe(true)
    expect(isSelfOwner({ entry: 'e1' }, self)).toBe(true)
    expect(isSelfOwner({ entry: 'e2' }, self)).toBe(false)
    expect(isSelfOwner({ global: 'company' }, self)).toBe(false)
  })

  it('matches a section by raw or camelCase key', () => {
    const section = { entryId: 'g1', globalKey: 'company_info' }
    expect(isSelfOwner({ global: 'companyInfo' }, section)).toBe(true)
    expect(isSelfOwner({ global: 'company_info' }, section)).toBe(true)
    expect(isSelfOwner({ entry: 'g1' }, section)).toBe(true)
  })
})

describe('otherOwners', () => {
  it('lists distinct owners that are not the page, sorted', () => {
    const markers: Marker[] = [
      { field: 'title', owner: null },
      { field: 'name', owner: { global: 'company' } },
      { field: 'email', owner: { global: 'company' } },
      { field: 'name', owner: { entry: 'a2' } },
      { field: 'body', owner: { entry: 'e1' } },
    ]
    expect(otherOwners(markers, { entryId: 'e1', globalKey: null })).toEqual([
      { entry: 'a2' },
      { global: 'company' },
    ])
  })

  it('caps the list at 100', () => {
    const markers: Marker[] = Array.from({ length: 150 }, (_, i) => ({
      field: 'name',
      owner: { entry: `x${String(i).padStart(3, '0')}` },
    }))
    expect(
      otherOwners(markers, { entryId: 'e1', globalKey: null }),
    ).toHaveLength(100)
  })
})

describe('buildTargets', () => {
  const markers: Marker[] = [
    { field: 'title', owner: null },
    { field: 'heroImage', owner: null },
    { field: 'subtitle', owner: null },
    { field: 'name', owner: { entry: 'a2' } },
    { field: 'name', owner: { global: 'company' } },
    { field: 'name', owner: { entry: 'gone' } },
  ]
  const owners = new Map([
    [
      'entry:a2',
      {
        kind: 'entry' as const,
        entryId: 'a2',
        collectionKey: 'authors',
        collectionLabel: 'Team',
        label: 'Ana',
      },
    ],
    [
      'global:company',
      {
        kind: 'global' as const,
        entryId: 'g1',
        globalKey: 'company',
        label: 'Company',
      },
    ],
    ['entry:gone', null],
  ])

  const built = buildTargets(markers, {
    fieldKeys: keys,
    labelOf: (key) =>
      ({ title: 'Title', hero_image: 'Hero image' })[key] ?? key,
    self: { entryId: 'e1', globalKey: null },
    owners,
    ownerLabel: (owner) =>
      owner.kind === 'entry'
        ? `${owner.collectionLabel} › ${owner.label}`
        : `Site content › ${owner.label}`,
  })

  it('labels the own fields and drops unknown keys', () => {
    expect(built.targets).toContainEqual({
      field: 'title',
      owner: null,
      label: 'Title',
    })
    expect(built.targets).toContainEqual({
      field: 'heroImage',
      owner: null,
      label: 'Hero image',
    })
    expect(built.targets.some((t) => t.field === 'subtitle')).toBe(false)
    expect(built.fieldOf.get('|heroImage')).toBe('hero_image')
  })

  it('includes only verified other owners', () => {
    expect(built.targets).toContainEqual({
      field: 'name',
      owner: { entry: 'a2' },
      label: 'Team › Ana',
    })
    expect(built.targets).toContainEqual({
      field: 'name',
      owner: { global: 'company' },
      label: 'Site content › Company',
    })
    expect(
      built.targets.some(
        (t) => t.owner && 'entry' in t.owner && t.owner.entry === 'gone',
      ),
    ).toBe(false)
  })

  it('treats unresolved owners (still loading) as unmarked', () => {
    const loading = buildTargets(markers, {
      fieldKeys: keys,
      labelOf: (key) => key,
      self: { entryId: 'e1', globalKey: null },
      owners: new Map(),
      ownerLabel: () => 'x',
    })
    expect(loading.targets.every((t) => t.owner === null)).toBe(true)
  })
})

describe('markerForField', () => {
  it('finds the marker a CMS field is shown by, as the page wrote it', () => {
    const built = buildTargets(
      [
        { field: 'heroImage', owner: null },
        { field: 'title', owner: { entry: 'e1' } },
      ],
      {
        fieldKeys: keys,
        labelOf: (key) => key,
        self: { entryId: 'e1', globalKey: null },
        owners: new Map(),
        ownerLabel: () => '',
      },
    )
    expect(markerForField('hero_image', built)).toEqual({
      field: 'heroImage',
      owner: null,
    })
    expect(markerForField('title', built)).toEqual({
      field: 'title',
      owner: { entry: 'e1' },
    })
    expect(markerForField('body', built)).toBeNull()
    expect(built.fieldOf.get('entry:e1|title')).toBe('title')
  })
})

describe('isAwayFrom', () => {
  const preview = 'https://site.test/__preview/articles/alpha?token=abc'

  it('is false on the preview page, whatever the query', () => {
    expect(
      isAwayFrom(
        'https://site.test/__preview/articles/alpha?token=xyz',
        preview,
      ),
    ).toBe(false)
    expect(
      isAwayFrom('https://site.test/__preview/articles/alpha/', preview),
    ).toBe(false)
  })

  it('is true on another page or origin', () => {
    expect(isAwayFrom('https://site.test/journal', preview)).toBe(true)
    expect(
      isAwayFrom('https://other.test/__preview/articles/alpha', preview),
    ).toBe(true)
  })

  it('is false when either URL is missing or unreadable', () => {
    expect(isAwayFrom(null, preview)).toBe(false)
    expect(isAwayFrom('about:blank', undefined)).toBe(false)
    expect(isAwayFrom('not a url', preview)).toBe(false)
  })
})
