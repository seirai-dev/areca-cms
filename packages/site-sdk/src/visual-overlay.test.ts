import { describe, expect, it } from 'vitest'
import { collectMarkers, findTarget, readMarker, type MarkedElement } from './visual-overlay.js'
import { MARKER_TEXT_MAX, MARKERS_MAX, markerKey } from './visual.js'

/** A tiny stand-in for an element: attributes plus a parent link. */
function el(attributes: Record<string, string> = {}, parent: MarkedElement | null = null): MarkedElement {
  return {
    getAttribute: (name: string) => (name in attributes ? attributes[name]! : null),
    parentElement: parent,
  }
}

describe('readMarker', () => {
  it('reads a field that belongs to the page entry', () => {
    expect(readMarker(el({ 'data-areca-field': 'title' }))).toEqual({ field: 'title', owner: null })
  })

  it('reads the owner from data-areca-entry', () => {
    expect(readMarker(el({ 'data-areca-field': 'name', 'data-areca-entry': 'a1' }))).toEqual({
      field: 'name',
      owner: { entry: 'a1' },
    })
  })

  it('reads the owner from data-areca-global when there is no entry', () => {
    expect(readMarker(el({ 'data-areca-field': '$seo.title', 'data-areca-global': 'company' }))).toEqual({
      field: '$seo.title',
      owner: { global: 'company' },
    })
  })

  it('prefers the entry owner when both owner attributes are present', () => {
    expect(
      readMarker(el({ 'data-areca-field': 'x', 'data-areca-entry': 'e', 'data-areca-global': 'g' })),
    ).toEqual({ field: 'x', owner: { entry: 'e' } })
  })

  it('returns null without a field attribute', () => {
    expect(readMarker(el({ 'data-areca-entry': 'a1' }))).toBeNull()
  })

  it.each([
    ['an empty field', { 'data-areca-field': '' }],
    ['a field over the length limit', { 'data-areca-field': 'x'.repeat(MARKER_TEXT_MAX + 1) }],
    ['an empty entry owner', { 'data-areca-field': 'a', 'data-areca-entry': '' }],
    ['an over-long global owner', { 'data-areca-field': 'a', 'data-areca-global': 'g'.repeat(MARKER_TEXT_MAX + 1) }],
  ])('rejects %s', (_name, attributes) => {
    expect(readMarker(el(attributes))).toBeNull()
  })

  it('accepts a field exactly at the length limit', () => {
    const field = 'x'.repeat(MARKER_TEXT_MAX)
    expect(readMarker(el({ 'data-areca-field': field }))?.field).toBe(field)
  })
})

describe('collectMarkers', () => {
  it('returns distinct markers in the order given', () => {
    const elements = [
      el({ 'data-areca-field': 'title' }),
      el({ 'data-areca-field': 'body' }),
      el({ 'data-areca-field': 'title' }),
      el({ 'data-areca-field': 'name', 'data-areca-global': 'company' }),
    ]
    expect(collectMarkers(elements)).toEqual([
      { field: 'title', owner: null },
      { field: 'body', owner: null },
      { field: 'name', owner: { global: 'company' } },
    ])
  })

  it('treats the same field with different owners as different markers', () => {
    const elements = [
      el({ 'data-areca-field': 'name' }),
      el({ 'data-areca-field': 'name', 'data-areca-entry': 'a1' }),
    ]
    expect(collectMarkers(elements)).toHaveLength(2)
  })

  it('skips elements without a valid marker', () => {
    expect(collectMarkers([el({}), el({ 'data-areca-field': '' }), el({ 'data-areca-field': 'ok' })])).toEqual([
      { field: 'ok', owner: null },
    ])
  })

  it('keeps at most MARKERS_MAX markers', () => {
    const elements = Array.from({ length: MARKERS_MAX + 20 }, (_, i) =>
      el({ 'data-areca-field': `f${i}` }),
    )
    const markers = collectMarkers(elements)
    expect(markers).toHaveLength(MARKERS_MAX)
    expect(markers[0]).toEqual({ field: 'f0', owner: null })
  })
})

describe('findTarget', () => {
  const title = { field: 'title', owner: null }
  const author = { field: 'name', owner: { entry: 'a1' } }
  const labels = new Map([
    [markerKey(title), 'Title'],
    [markerKey(author), 'Author name'],
  ])

  it('returns the element itself when it is a target', () => {
    const h1 = el({ 'data-areca-field': 'title' })
    expect(findTarget(h1, labels)).toEqual({ element: h1, marker: title, label: 'Title' })
  })

  it('walks up to the nearest marked ancestor', () => {
    const body = el({ 'data-areca-field': 'title' })
    const span = el({}, body)
    const strong = el({}, span)
    expect(findTarget(strong, labels)).toEqual({ element: body, marker: title, label: 'Title' })
  })

  it('prefers the nearest target over an outer one', () => {
    const outer = el({ 'data-areca-field': 'title' })
    const inner = el({ 'data-areca-field': 'name', 'data-areca-entry': 'a1' }, outer)
    expect(findTarget(inner, labels)?.marker).toEqual(author)
  })

  it('skips marked elements that are not targets and keeps walking', () => {
    const outer = el({ 'data-areca-field': 'title' })
    const inner = el({ 'data-areca-field': 'price' }, outer)
    expect(findTarget(inner, labels)).toEqual({ element: outer, marker: title, label: 'Title' })
  })

  it('does not match a field whose owner differs', () => {
    const otherOwner = el({ 'data-areca-field': 'name', 'data-areca-entry': 'b2' })
    expect(findTarget(otherOwner, labels)).toBeNull()
  })

  it('returns null when no ancestor is a target', () => {
    expect(findTarget(el({}, el({})), labels)).toBeNull()
  })

  it('returns null for a null start', () => {
    expect(findTarget(null, labels)).toBeNull()
  })
})
