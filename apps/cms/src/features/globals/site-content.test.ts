import { describe, expect, it } from 'vitest'

import { groupFields, siteContentNavItems } from './site-content'

// Assumed API (red phase), pure helpers for the "Site content" sidebar group
// and the section editor:
//   siteContentNavItems(
//     globals: { key: string; label: string; enabled: boolean }[],
//     options: { isAgencyAdmin: boolean },
//   ): { key; label; enabled; to }[]
//   groupFields(fields: { key; label; type; group?: string }[])
//     : { group: string | null; fields: F[] }[]

const sections = [
  { key: 'companyInfo', label: 'Company info', enabled: true },
  { key: 'homePage', label: 'Home page', enabled: false },
  { key: 'aboutPage', label: 'About page', enabled: true },
]

describe('siteContentNavItems', () => {
  it('shows only enabled sections to non-agency users, in the given order', () => {
    const items = siteContentNavItems(sections, { isAgencyAdmin: false })
    expect(items.map((item) => item.key)).toEqual(['companyInfo', 'aboutPage'])
    expect(items.every((item) => item.enabled)).toBe(true)
  })

  it('is empty for non-agency users when no section is enabled (group hidden)', () => {
    const items = siteContentNavItems(
      sections.map((s) => ({ ...s, enabled: false })),
      { isAgencyAdmin: false },
    )
    expect(items).toEqual([])
  })

  it('lists every section to the agency, disabled ones flagged', () => {
    const items = siteContentNavItems(sections, { isAgencyAdmin: true })
    expect(items.map((item) => item.key)).toEqual([
      'companyInfo',
      'homePage',
      'aboutPage',
    ])
    expect(items.map((item) => item.enabled)).toEqual([true, false, true])
  })

  it('uses the section label for the item', () => {
    const items = siteContentNavItems(sections, { isAgencyAdmin: true })
    expect(items.map((item) => item.label)).toEqual([
      'Company info',
      'Home page',
      'About page',
    ])
  })

  it('shows nothing for a site without sections', () => {
    expect(siteContentNavItems([], { isAgencyAdmin: true })).toEqual([])
    expect(siteContentNavItems([], { isAgencyAdmin: false })).toEqual([])
  })
})

describe('groupFields', () => {
  const field = (key: string, group?: string) => ({
    key,
    label: key,
    type: 'text',
    ...(group === undefined ? {} : { group }),
  })

  it('returns one ungrouped run when no field has a group', () => {
    const fields = [field('a'), field('b')]
    expect(groupFields(fields)).toEqual([{ group: null, fields }])
  })

  it('starts a new run whenever the group changes', () => {
    const a = field('a')
    const b = field('b', 'Contact')
    const c = field('c', 'Contact')
    const d = field('d', 'Address')
    const e = field('e')
    expect(groupFields([a, b, c, d, e])).toEqual([
      { group: null, fields: [a] },
      { group: 'Contact', fields: [b, c] },
      { group: 'Address', fields: [d] },
      { group: null, fields: [e] },
    ])
  })

  it('keeps the field objects in order', () => {
    const fields = [field('a', 'X'), field('b', 'X'), field('c', 'Y')]
    const runs = groupFields(fields)
    expect(runs.flatMap((run) => run.fields)).toEqual(fields)
    expect(runs[0].fields[0]).toBe(fields[0])
  })

  it('starts a new heading when the same group reappears after another', () => {
    const runs = groupFields([
      field('a', 'Contact'),
      field('b'),
      field('c', 'Contact'),
    ])
    expect(runs.map((run) => run.group)).toEqual(['Contact', null, 'Contact'])
  })

  it('returns no runs for no fields', () => {
    expect(groupFields([])).toEqual([])
  })
})
