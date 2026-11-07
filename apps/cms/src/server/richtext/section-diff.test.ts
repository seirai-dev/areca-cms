import { describe, expect, it } from 'vitest'

import type { SectionSnapshots } from '#/lib/types'
import { richTextHeadings, remapSectionLinks } from './entry-links'
import { createHeadingIds } from './heading-ids'
import { diffSectionSnapshots, sectionKey } from './section-diff'

const key = sectionKey('nl', 'body')
const h = (id: string, text: string) => ({ id, text })

function snapshots(list: { id: string; text: string }[], locale = 'nl') {
  return { [sectionKey(locale, 'body')]: list } satisfies SectionSnapshots
}

describe('diffSectionSnapshots', () => {
  it('reports a heading renamed in place: the same position, new text', () => {
    const before = snapshots([h('intro', 'Intro'), h('origin', 'Origin')])
    const after = snapshots([
      h('intro', 'Intro'),
      h('where-it-grows', 'Where it grows'),
    ])
    expect(diffSectionSnapshots(before, after)).toEqual([
      {
        locale: 'nl',
        from: 'origin',
        fromText: 'Origin',
        to: 'where-it-grows',
        toText: 'Where it grows',
        headings: after[key],
      },
    ])
  })

  it('reports a removed heading when nothing new sits at its position', () => {
    const before = snapshots([h('intro', 'Intro'), h('origin', 'Origin')])
    const after = snapshots([h('intro', 'Intro')])
    const [change] = diffSectionSnapshots(before, after)
    expect(change).toMatchObject({ from: 'origin', to: null, toText: null })
  })

  it('treats a heading that moved as unchanged', () => {
    const before = snapshots([h('a', 'A'), h('b', 'B'), h('c', 'C')])
    const after = snapshots([h('c', 'C'), h('a', 'A'), h('b', 'B')])
    expect(diffSectionSnapshots(before, after)).toEqual([])
  })

  it('does not call a heading renamed to a heading that already existed', () => {
    // "A" becomes "B" at position 0, but "B" is still there at position 1: the
    // old "A" has no new section to go to.
    const before = snapshots([h('a', 'A'), h('b', 'B')])
    const after = snapshots([h('b', 'B'), h('b-2', 'B')])
    const changes = diffSectionSnapshots(before, after)
    expect(changes).toEqual([expect.objectContaining({ from: 'a', to: null })])
  })

  it('keeps repeated headings apart by their numbered ids', () => {
    // Two "Origin" headings: origin and origin-2. The second is renamed.
    const ids = createHeadingIds()
    const before = snapshots([
      h(ids('Origin'), 'Origin'),
      h(ids('Origin'), 'Origin'),
    ])
    expect(before[key].map((heading) => heading.id)).toEqual([
      'origin',
      'origin-2',
    ])
    const renamed = createHeadingIds()
    const after = snapshots([
      h(renamed('Origin'), 'Origin'),
      h(renamed('Where'), 'Where'),
    ])
    expect(diffSectionSnapshots(before, after)).toEqual([
      expect.objectContaining({ from: 'origin-2', to: 'where' }),
    ])
  })

  it('reports nothing when the first of two repeated headings is removed and the second keeps its id', () => {
    // origin-2 is still the id of the second heading? No: it is now the only
    // "Origin", so the first survives as "origin" and "origin-2" is gone.
    const before = snapshots([h('origin', 'Origin'), h('origin-2', 'Origin')])
    const after = snapshots([h('origin', 'Origin')])
    expect(diffSectionSnapshots(before, after)).toEqual([
      expect.objectContaining({ from: 'origin-2', to: null }),
    ])
  })

  it('compares each language on its own', () => {
    const before: SectionSnapshots = {
      [sectionKey('nl', 'body')]: [h('origin', 'Oorsprong')],
      [sectionKey('en', 'body')]: [h('origin', 'Origin')],
    }
    const after: SectionSnapshots = {
      [sectionKey('nl', 'body')]: [h('oorsprong', 'Oorsprong')],
      [sectionKey('en', 'body')]: [h('origin', 'Origin')],
    }
    expect(diffSectionSnapshots(before, after)).toEqual([
      expect.objectContaining({
        locale: 'nl',
        from: 'origin',
        to: 'oorsprong',
      }),
    ])
  })

  it('treats a value that is gone as all of its headings removed', () => {
    const before = snapshots([h('a', 'A'), h('b', 'B')])
    const changes = diffSectionSnapshots(before, {})
    expect(changes.map((change) => [change.from, change.to])).toEqual([
      ['a', null],
      ['b', null],
    ])
  })

  it('ignores a value that was not there before', () => {
    expect(diffSectionSnapshots({}, snapshots([h('a', 'A')]))).toEqual([])
  })

  it('keeps one change per language and id when two fields share a heading', () => {
    const before: SectionSnapshots = {
      [sectionKey('nl', 'body')]: [h('origin', 'Origin')],
      [sectionKey('nl', 'summary')]: [h('origin', 'Origin')],
    }
    const after: SectionSnapshots = {
      [sectionKey('nl', 'body')]: [h('herkomst', 'Herkomst')],
      [sectionKey('nl', 'summary')]: [h('herkomst', 'Herkomst')],
    }
    expect(diffSectionSnapshots(before, after)).toHaveLength(1)
  })

  it('reads the headings of a real document the way the editor and the links do', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Origin' }],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Origin' }],
        },
      ],
    }
    expect(richTextHeadings(doc).map((heading) => heading.id)).toEqual([
      'origin',
      'origin-2',
    ])
  })
})

describe('remapSectionLinks', () => {
  const target = 'entry-target'
  const link = (
    entryId: string,
    anchor: string | null,
    href = '/blog/ethiopia',
  ) => ({
    type: 'text',
    text: 'Lees',
    marks: [
      {
        type: 'link',
        attrs: { href, entryId, collection: 'articles', anchor },
      },
    ],
  })
  const doc = (...nodes: unknown[]) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: nodes }],
  })

  it('moves the section and the href fragment, and keeps the entry', () => {
    const { json, changed } = remapSectionLinks(
      doc(link(target, 'origin', '/blog/ethiopia#origin')),
      target,
      (anchor) => (anchor === 'origin' ? 'where-it-grows' : undefined),
    )
    expect(changed).toBe(true)
    const mark = (
      json as {
        content: {
          content: { marks: { attrs: Record<string, unknown> }[] }[]
        }[]
      }
    ).content[0].content[0].marks[0]
    expect(mark.attrs).toEqual({
      href: '/blog/ethiopia#where-it-grows',
      entryId: target,
      collection: 'articles',
      anchor: 'where-it-grows',
    })
  })

  it('makes a link to the page when the new section is the page', () => {
    const { json } = remapSectionLinks(
      doc(link(target, 'origin', '/blog/ethiopia#origin')),
      target,
      () => '',
    )
    const mark = (
      json as {
        content: {
          content: { marks: { attrs: Record<string, unknown> }[] }[]
        }[]
      }
    ).content[0].content[0].marks[0]
    expect(mark.attrs).toMatchObject({
      href: '/blog/ethiopia',
      anchor: null,
      entryId: target,
    })
  })

  it('leaves links to other entries, other sections and the page alone', () => {
    const input = doc(
      link('someone-else', 'origin', '/blog/other#origin'),
      link(target, 'faq', '/blog/ethiopia#faq'),
      link(target, null, '/blog/ethiopia'),
    )
    const { json, changed } = remapSectionLinks(input, target, (anchor) =>
      anchor === 'origin' ? 'x' : undefined,
    )
    expect(changed).toBe(false)
    expect(json).toEqual(input)
  })

  it('does not change the input', () => {
    const input = doc(link(target, 'origin', '/blog/ethiopia#origin'))
    remapSectionLinks(input, target, () => 'where')
    const paragraph = input.content[0] as {
      content: { marks: { attrs: { anchor: string } }[] }[]
    }
    expect(paragraph.content[0].marks[0].attrs.anchor).toBe('origin')
  })
})
