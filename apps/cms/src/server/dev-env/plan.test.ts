import { describe, expect, it } from 'vitest'

import type { Field, SchemaSnapshotItem } from '#/lib/types'

import {
  buildPlan,
  collectionsMatchProduction,
  productionChangeCount,
  selectPlanItems,
  stableStringify,
} from './plan'
import type { PlanEntry, PlanInput, PlanProductionEntry } from './plan'

const field = (key: string, type: Field['type'] = 'text'): Field => ({
  key,
  label: key,
  type,
})

function def(
  key: string,
  fields: Field[] = [field('title')],
  extra: Partial<SchemaSnapshotItem> = {},
): SchemaSnapshotItem {
  return {
    key,
    label: key,
    routePattern: `/${key}/$slug`,
    fields,
    enabled: true,
    kind: 'collection',
    seoEnabled: false,
    previewPath: null,
    requiredLanguages: [],
    localizedRoutes: null,
    ...extra,
  }
}

const snapshot = (
  collections: SchemaSnapshotItem[],
  languages: PlanInput['dev']['languages'] = null,
) => ({ languages, collections })

const devEntry = (overrides: Partial<PlanEntry> = {}): PlanEntry => ({
  id: 'd1',
  collectionKey: 'articles',
  collectionKind: 'collection',
  slug: 'a',
  title: 'A',
  status: 'published',
  draftData: { title: 'A' },
  publishedSlug: 'a',
  publishedData: { title: 'A' },
  originEntryId: 'p1',
  originBaseline: {
    slug: 'a',
    data: { title: 'A' },
    publishedSlug: 'a',
    publishedData: { title: 'A' },
    status: 'published',
  },
  originContentVersion: 3,
  ...overrides,
})

const prodEntry = (
  overrides: Partial<PlanProductionEntry> = {},
): PlanProductionEntry => ({
  id: 'p1',
  collectionKey: 'articles',
  collectionKind: 'collection',
  slug: 'a',
  contentVersion: 3,
  status: 'published',
  scheduled: false,
  ...overrides,
})

function planInput(overrides: Partial<PlanInput> = {}): PlanInput {
  const articles = def('articles')
  return {
    base: snapshot([articles]),
    dev: snapshot([articles]),
    production: snapshot([articles]),
    devEntries: [],
    productionEntries: [],
    productionFieldUsage: {},
    stampCount: 0,
    ...overrides,
  }
}

describe('buildPlan: nothing changed', () => {
  it('returns no items for an unchanged dev env', () => {
    const plan = buildPlan(
      planInput({ devEntries: [devEntry()], productionEntries: [prodEntry()] }),
    )
    expect(plan.items).toEqual([])
  })
})

describe('buildPlan: schema', () => {
  it('adds a collection that only dev has', () => {
    const plan = buildPlan(
      planInput({
        dev: snapshot([def('articles'), def('cases')]),
      }),
    )
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]).toMatchObject({
      id: 'schema:cases',
      kind: 'schema.add',
      attention: null,
      devChanged: true,
      productionChanged: false,
    })
  })

  it('flags a collection added in production with another definition as a conflict', () => {
    const plan = buildPlan(
      planInput({
        dev: snapshot([def('articles'), def('cases')]),
        production: snapshot([def('articles'), def('cases', [field('name')])]),
      }),
    )
    expect(plan.items[0]).toMatchObject({
      id: 'schema:cases',
      kind: 'schema.add',
      attention: 'conflict',
      productionChanged: true,
    })
  })

  it('reports a field removal that drops production values as drops-content with the count', () => {
    const base = def('articles', [field('title'), field('excerpt', 'textarea')])
    const plan = buildPlan(
      planInput({
        base: snapshot([base]),
        dev: snapshot([def('articles')]),
        production: snapshot([base]),
        productionFieldUsage: { articles: { excerpt: 4 } },
      }),
    )
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]).toMatchObject({
      id: 'schema:articles',
      kind: 'schema.change',
      attention: 'drops-content',
      summary: {
        droppedFields: [{ key: 'excerpt', values: 4 }],
        changedFields: ['excerpt'],
      },
    })
  })

  it('does not flag a removal of a field with no production values', () => {
    const base = def('articles', [field('title'), field('excerpt', 'textarea')])
    const plan = buildPlan(
      planInput({
        base: snapshot([base]),
        dev: snapshot([def('articles')]),
        production: snapshot([base]),
        productionFieldUsage: { articles: {} },
      }),
    )
    expect(plan.items[0]?.attention).toBeNull()
    expect(plan.items[0]?.summary.droppedFields).toBeUndefined()
  })

  it('flags a change that production has also changed as a conflict', () => {
    const base = def('articles')
    const plan = buildPlan(
      planInput({
        base: snapshot([base]),
        dev: snapshot([def('articles', [field('title'), field('subtitle')])]),
        production: snapshot([
          def('articles', [field('title'), field('lead')]),
        ]),
      }),
    )
    expect(plan.items[0]).toMatchObject({
      kind: 'schema.change',
      attention: 'conflict',
      productionChanged: true,
    })
  })

  it('treats a dev change equal to production as no conflict', () => {
    const base = def('articles')
    const plan = buildPlan(
      planInput({
        base: snapshot([base]),
        dev: snapshot([def('articles', [field('title'), field('lead')])]),
        production: snapshot([
          def('articles', [field('title'), field('lead')]),
        ]),
      }),
    )
    expect(plan.items[0]?.attention).toBeNull()
    expect(plan.items[0]?.productionChanged).toBe(true)
  })

  it('removes a collection that dev deleted, flagged when production has content', () => {
    const legacy = def('legacy')
    const plan = buildPlan(
      planInput({
        base: snapshot([def('articles'), legacy]),
        dev: snapshot([def('articles')]),
        production: snapshot([def('articles'), legacy]),
        productionFieldUsage: { legacy: { title: 2 } },
      }),
    )
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]).toMatchObject({
      id: 'schema:legacy',
      kind: 'schema.remove',
      attention: 'drops-content',
      summary: { droppedFields: [{ key: 'title', values: 2 }] },
    })
  })

  it('does not flag a removal when production already removed the collection', () => {
    const legacy = def('legacy')
    const plan = buildPlan(
      planInput({
        base: snapshot([def('articles'), legacy]),
        dev: snapshot([def('articles')]),
        production: snapshot([def('articles')]),
      }),
    )
    expect(plan.items[0]).toMatchObject({
      kind: 'schema.remove',
      attention: null,
    })
  })

  it('titles a collection item with the collection label', () => {
    const offers = def('offers', [field('title')], { label: 'Offers' })
    const plan = buildPlan(
      planInput({
        dev: snapshot([def('articles'), offers]),
      }),
    )
    expect(plan.items[0]).toMatchObject({
      kind: 'schema.add',
      title: 'Offers',
    })
    expect(plan.items[0]?.collectionLabel).toBeUndefined()
  })

  it('titles a section item with its section label', () => {
    const footer = def('footer', [field('note')], {
      kind: 'global',
      label: 'Footer',
    })
    const plan = buildPlan(
      planInput({
        dev: snapshot([def('articles'), footer]),
      }),
    )
    expect(plan.items[0]).toMatchObject({ kind: 'schema.add', title: 'Footer' })
  })
})

describe('buildPlan: languages', () => {
  const base = snapshot([def('articles')], { main: 'en', all: ['en'] })

  it('adds a language without attention', () => {
    const plan = buildPlan(
      planInput({
        base,
        dev: snapshot([def('articles')], { main: 'en', all: ['en', 'nl'] }),
        production: snapshot([def('articles')], { main: 'en', all: ['en'] }),
      }),
    )
    expect(plan.items[0]).toMatchObject({
      id: 'languages',
      kind: 'languages',
      attention: null,
      summary: {},
    })
  })

  it('flags a main-language change with the stamp count', () => {
    const plan = buildPlan(
      planInput({
        base,
        dev: snapshot([def('articles')], { main: 'nl', all: ['en', 'nl'] }),
        production: snapshot([def('articles')], { main: 'en', all: ['en'] }),
        stampCount: 7,
      }),
    )
    expect(plan.items[0]).toMatchObject({
      id: 'languages',
      attention: 'main-language',
      summary: { stampCount: 7 },
    })
  })

  it('flags languages changed in production as a conflict', () => {
    const plan = buildPlan(
      planInput({
        base,
        dev: snapshot([def('articles')], { main: 'en', all: ['en', 'nl'] }),
        production: snapshot([def('articles')], {
          main: 'en',
          all: ['en', 'de'],
        }),
      }),
    )
    expect(plan.items[0]).toMatchObject({
      attention: 'conflict',
      productionChanged: true,
    })
  })

  it('treats a first language on a monolingual baseline as no main change', () => {
    const plan = buildPlan(
      planInput({
        base: snapshot([def('articles')], null),
        dev: snapshot([def('articles')], { main: 'en', all: ['en'] }),
        production: snapshot([def('articles')], null),
      }),
    )
    expect(plan.items[0]?.attention).toBeNull()
  })
})

describe('buildPlan: entries', () => {
  it('changes a draft in dev', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [devEntry({ draftData: { title: 'B' } })],
        productionEntries: [prodEntry()],
      }),
    )
    expect(plan.items).toEqual([
      expect.objectContaining({
        id: 'entry:d1',
        kind: 'entry.change',
        attention: null,
        devChanged: true,
        productionChanged: false,
        productionId: 'p1',
        productionContentVersion: 3,
        summary: {
          changedFields: ['title'],
          draftChanged: true,
          readyChanged: false,
        },
      }),
    ])
  })

  it('reports a ready-only change as readyChanged', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [devEntry({ publishedData: { title: 'Ready' } })],
        productionEntries: [prodEntry()],
      }),
    )
    expect(plan.items[0]?.summary).toMatchObject({
      draftChanged: false,
      readyChanged: true,
      changedFields: ['title'],
    })
  })

  it('flags a dev change over a production change as a conflict', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [devEntry({ draftData: { title: 'B' } })],
        productionEntries: [prodEntry({ contentVersion: 4 })],
      }),
    )
    expect(plan.items[0]).toMatchObject({
      kind: 'entry.change',
      attention: 'conflict',
      productionChanged: true,
    })
  })

  it('flags a scheduled production entry as scheduled, ahead of a conflict', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [devEntry({ draftData: { title: 'B' } })],
        productionEntries: [prodEntry({ contentVersion: 4, scheduled: true })],
      }),
    )
    expect(plan.items[0]?.attention).toBe('scheduled')
  })

  it('lists a changed entry deleted in production as deleted-in-production without a production id', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [devEntry({ draftData: { title: 'B' } })],
        productionEntries: [],
      }),
    )
    expect(plan.items[0]).toMatchObject({
      kind: 'entry.change',
      attention: 'deleted-in-production',
      productionChanged: true,
    })
    expect(plan.items[0]?.productionId).toBeUndefined()
  })

  it('emits nothing for an entry deleted in production that dev did not change', () => {
    const plan = buildPlan(planInput({ devEntries: [devEntry()] }))
    expect(plan.items).toEqual([])
  })

  it('emits nothing when only production changed', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [devEntry()],
        productionEntries: [prodEntry({ contentVersion: 9 })],
      }),
    )
    expect(plan.items).toEqual([])
  })

  it('archives an entry archived in dev', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [devEntry({ status: 'archived' })],
        productionEntries: [prodEntry()],
      }),
    )
    expect(plan.items[0]).toMatchObject({
      kind: 'entry.archive',
      attention: null,
      productionId: 'p1',
    })
  })

  it('emits nothing for an archived dev entry whose production row is gone', () => {
    const plan = buildPlan(
      planInput({ devEntries: [devEntry({ status: 'archived' })] }),
    )
    expect(plan.items).toEqual([])
  })

  it('treats an entry with no baseline as changed', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [devEntry({ originBaseline: null })],
        productionEntries: [prodEntry()],
      }),
    )
    expect(plan.items[0]?.kind).toBe('entry.change')
  })

  it('lists a dev-created entry as new', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [
          devEntry({
            id: 'd2',
            originEntryId: null,
            originBaseline: null,
            originContentVersion: null,
            slug: 'fresh',
            draftData: { title: 'Fresh' },
          }),
        ],
      }),
    )
    expect(plan.items[0]).toMatchObject({
      id: 'entry:d2',
      kind: 'entry.new',
      attention: null,
      devChanged: true,
    })
    expect(plan.items[0]?.productionId).toBeUndefined()
  })

  it('does not list a dev-created entry that is archived', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [
          devEntry({
            id: 'd2',
            originEntryId: null,
            originBaseline: null,
            originContentVersion: null,
            status: 'archived',
          }),
        ],
      }),
    )
    expect(plan.items).toEqual([])
  })

  it('does not list a new entry in a collection production does not have', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [
          devEntry({
            id: 'd2',
            collectionKey: 'cases',
            originEntryId: null,
            originBaseline: null,
            originContentVersion: null,
          }),
        ],
      }),
    )
    expect(plan.items).toEqual([])
  })

  it('lists a new entry in a collection that the same push adds', () => {
    const plan = buildPlan(
      planInput({
        dev: snapshot([def('articles'), def('cases')]),
        devEntries: [
          devEntry({
            id: 'd2',
            collectionKey: 'cases',
            originEntryId: null,
            originBaseline: null,
            originContentVersion: null,
          }),
        ],
      }),
    )
    expect(plan.items.map((item) => item.id)).toEqual([
      'schema:cases',
      'entry:d2',
    ])
  })

  it('matches a dev-created section entry to its production section', () => {
    const footer = def('footer', [field('note')], { kind: 'global' })
    const plan = buildPlan(
      planInput({
        base: snapshot([def('articles'), footer]),
        dev: snapshot([def('articles'), footer]),
        production: snapshot([def('articles'), footer]),
        devEntries: [
          devEntry({
            id: 'd9',
            collectionKey: 'footer',
            collectionKind: 'global',
            slug: '$global',
            originEntryId: null,
            originBaseline: null,
            originContentVersion: null,
            draftData: { note: 'Hi' },
          }),
        ],
        productionEntries: [
          prodEntry({
            id: 'pg',
            collectionKey: 'footer',
            collectionKind: 'global',
            slug: '$global',
          }),
        ],
      }),
    )
    expect(plan.items[0]).toMatchObject({
      id: 'entry:d9',
      kind: 'entry.change',
      productionId: 'pg',
    })
  })
})

describe('buildPlan: plan hash', () => {
  const build = (overrides: Partial<PlanInput> = {}) =>
    buildPlan(
      planInput({
        devEntries: [devEntry({ draftData: { title: 'B' } })],
        productionEntries: [prodEntry()],
        ...overrides,
      }),
    ).planHash

  it('is the same for the same plan, whatever the input order', () => {
    const entries = [
      devEntry({ draftData: { title: 'B' } }),
      devEntry({
        id: 'd2',
        slug: 'b',
        originEntryId: null,
        originBaseline: null,
        originContentVersion: null,
      }),
    ]
    expect(build({ devEntries: entries })).toBe(
      build({ devEntries: [...entries].reverse() }),
    )
  })

  it('changes when a dev edit changes an item that is already listed', () => {
    expect(build()).not.toBe(
      build({
        devEntries: [devEntry({ draftData: { title: 'C' } })],
      }),
    )
  })

  it('does not change when only the row titles change', () => {
    expect(build()).toBe(
      build({
        devEntries: [
          devEntry({
            draftData: { title: 'B' },
            title: 'Renamed in the loader',
          }),
        ],
        productionEntries: [prodEntry()],
      }),
    )
  })

  it('changes when the production version of a listed entry moves', () => {
    expect(build()).not.toBe(
      build({ productionEntries: [prodEntry({ contentVersion: 4 })] }),
    )
  })

  it('changes when a production schema item changes under a listed dev change', () => {
    const base = def('articles')
    const dev = snapshot([def('articles', [field('title'), field('lead')])])
    const before = buildPlan(
      planInput({
        base: snapshot([base]),
        dev,
        production: snapshot([base]),
      }),
    ).planHash
    const after = buildPlan(
      planInput({
        base: snapshot([base]),
        dev,
        production: snapshot([def('articles', [field('title'), field('x')])]),
      }),
    ).planHash
    expect(before).not.toBe(after)
  })
})

describe('selectPlanItems', () => {
  const items = buildPlan(
    planInput({
      dev: snapshot([def('articles'), def('cases')]),
      devEntries: [
        devEntry({ draftData: { title: 'B' } }),
        devEntry({
          id: 'd9',
          draftData: { title: 'C' },
          originEntryId: 'p9',
          originContentVersion: 1,
        }),
      ],
      productionEntries: [
        prodEntry({ contentVersion: 4 }),
        prodEntry({ id: 'p9', slug: 'z', scheduled: true }),
      ],
    }),
  ).items

  it('selects the unflagged items and skips the flagged ones by default', () => {
    const { selected, skipped } = selectPlanItems(items, {
      exclude: [],
      apply: [],
    })
    expect(selected.map((item) => item.id)).toEqual(['schema:cases'])
    expect(skipped.map((item) => item.id)).toEqual(['entry:d1', 'entry:d9'])
  })

  it('applies a flagged item only when it is in apply', () => {
    const { selected } = selectPlanItems(items, {
      exclude: [],
      apply: ['entry:d1'],
    })
    expect(selected.map((item) => item.id)).toEqual([
      'schema:cases',
      'entry:d1',
    ])
  })

  it('never applies a scheduled item', () => {
    const { selected } = selectPlanItems(items, {
      exclude: [],
      apply: ['entry:d9'],
    })
    expect(selected.map((item) => item.id)).not.toContain('entry:d9')
  })

  it('drops excluded items even when they are unflagged', () => {
    const { selected } = selectPlanItems(items, {
      exclude: ['schema:cases'],
      apply: [],
    })
    expect(selected).toEqual([])
  })
})

describe('productionChangeCount', () => {
  it('is zero when production matches the baseline', () => {
    expect(
      productionChangeCount(
        planInput({
          devEntries: [devEntry()],
          productionEntries: [prodEntry()],
        }),
      ),
    ).toBe(0)
  })

  it('counts moved entries, missing entries, and schema and language changes', () => {
    const base = snapshot([def('articles')], { main: 'en', all: ['en'] })
    expect(
      productionChangeCount(
        planInput({
          base,
          production: snapshot(
            [def('articles', [field('title'), field('x')])],
            {
              main: 'en',
              all: ['en'],
            },
          ),
          devEntries: [devEntry(), devEntry({ id: 'd2', originEntryId: 'p2' })],
          productionEntries: [prodEntry({ contentVersion: 4 })],
        }),
      ),
    ).toBe(3)
  })
})

describe('stableStringify', () => {
  it('sorts object keys and drops undefined members', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: undefined } })).toBe(
      '{"a":{"d":2},"b":1}',
    )
  })
})

describe('buildPlan: entry row titles', () => {
  it('titles an entry row with its title and the collection label', () => {
    const plan = buildPlan(
      planInput({
        base: snapshot([
          def('articles', [field('title')], { label: 'Articles' }),
        ]),
        dev: snapshot([
          def('articles', [field('title')], { label: 'Articles' }),
        ]),
        production: snapshot([
          def('articles', [field('title')], { label: 'Articles' }),
        ]),
        devEntries: [
          devEntry({
            title: 'Spring menu',
            draftData: { title: 'Spring menu' },
          }),
        ],
        productionEntries: [prodEntry()],
      }),
    )
    expect(plan.items[0]).toMatchObject({
      title: 'Spring menu',
      collectionLabel: 'Articles',
    })
  })

  it('leaves the collection label off a section entry row', () => {
    const footer = def('footer', [field('note')], {
      kind: 'global',
      label: 'Footer',
    })
    const plan = buildPlan(
      planInput({
        base: snapshot([footer]),
        dev: snapshot([footer]),
        production: snapshot([footer]),
        devEntries: [
          devEntry({
            id: 'd9',
            collectionKey: 'footer',
            collectionKind: 'global',
            slug: 'footer',
            title: 'Footer',
            draftData: { note: 'B' },
            originEntryId: 'p9',
            originBaseline: {
              slug: 'footer',
              data: { note: 'A' },
              publishedSlug: 'footer',
              publishedData: null,
              status: 'published',
            },
            originContentVersion: 1,
          }),
        ],
        productionEntries: [
          prodEntry({
            id: 'p9',
            collectionKey: 'footer',
            collectionKind: 'global',
            slug: 'footer',
            contentVersion: 1,
          }),
        ],
      }),
    )
    expect(plan.items[0]?.title).toBe('Footer')
    expect(plan.items[0]?.collectionLabel).toBeUndefined()
  })
})

describe('collectionsMatchProduction', () => {
  it('matches a collection only when its whole definition is the same', () => {
    const articles = def('articles')
    const matches = collectionsMatchProduction({
      dev: snapshot([articles, def('cases')]),
      production: snapshot([
        articles,
        def('cases', [field('title'), field('slug')]),
      ]),
    })
    expect(matches).toEqual({ articles: true, cases: false })
  })

  it('treats a collection missing on one side as a mismatch', () => {
    const matches = collectionsMatchProduction({
      dev: snapshot([def('articles')]),
      production: snapshot([def('pages')]),
    })
    expect(matches).toEqual({ articles: false, pages: false })
  })

  it('compares the kind, so a section and a collection of the same key differ', () => {
    const matches = collectionsMatchProduction({
      dev: snapshot([def('home', [field('title')], { kind: 'global' })]),
      production: snapshot([def('home')]),
    })
    expect(matches).toEqual({ home: false })
  })
})
