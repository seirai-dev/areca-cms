import { describe, expect, it } from 'vitest'

import type { EntryData, Field, SchemaSnapshotItem } from '#/lib/types'

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
          slug: 'z',
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

  it('never applies a slug-taken item, even when it is in apply', () => {
    const taken = items.map((item) =>
      item.id === 'entry:d1'
        ? { ...item, attention: 'slug-taken' as const }
        : item,
    )
    const { selected, skipped } = selectPlanItems(taken, {
      exclude: [],
      apply: ['entry:d1'],
    })
    expect(selected.map((item) => item.id)).not.toContain('entry:d1')
    expect(skipped.map((item) => item.id)).toContain('entry:d1')
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

describe('buildPlan: fields a pending removal keeps', () => {
  const withExcerpt = def('articles', [field('title'), field('excerpt')])
  const withoutExcerpt = def('articles', [field('title')])
  const baselineWithExcerpt = {
    slug: 'a',
    data: { title: 'A', excerpt: 'Intro' },
    publishedSlug: 'a',
    publishedData: { title: 'A', excerpt: 'Intro' },
    status: 'published' as const,
  }

  function removalInput(production: Partial<PlanProductionEntry> = {}) {
    return planInput({
      base: snapshot([withExcerpt]),
      dev: snapshot([withoutExcerpt]),
      production: snapshot([withExcerpt]),
      devEntries: [
        devEntry({
          draftData: { title: 'B' },
          publishedData: { title: 'B' },
          originBaseline: baselineWithExcerpt,
        }),
      ],
      productionEntries: [
        prodEntry({
          draftData: { title: 'A', excerpt: 'Intro' },
          publishedData: { title: 'A', excerpt: 'Intro' },
          ...production,
        }),
      ],
      productionFieldUsage: { articles: { excerpt: 1 } },
    })
  }

  it('links an entry that holds a value for the removed field to the removal', () => {
    const plan = buildPlan(removalInput())
    expect(plan.items.find((item) => item.id === 'entry:d1')).toMatchObject({
      dependsOn: ['schema:articles'],
      summary: expect.objectContaining({ preservedFields: ['excerpt'] }),
    })
    expect(
      plan.items.find((item) => item.id === 'schema:articles'),
    ).toMatchObject({
      attention: 'drops-content',
      affectedEntries: [{ id: 'p1', contentVersion: 3 }],
    })
  })

  it('does not link an entry that holds no value for the removed field', () => {
    const plan = buildPlan(
      removalInput({
        draftData: { title: 'A' },
        publishedData: { title: 'A' },
      }),
    )
    const entryItem = plan.items.find((item) => item.id === 'entry:d1')
    expect(entryItem?.dependsOn).toBeUndefined()
    expect(entryItem?.summary.preservedFields).toBeUndefined()
    expect(
      plan.items.find((item) => item.id === 'schema:articles')?.affectedEntries,
    ).toBeUndefined()
  })

  it('counts a value held only in a translation as held', () => {
    const plan = buildPlan(
      removalInput({
        draftData: { title: 'A', $i18n: { nl: { excerpt: 'Inleiding' } } },
        publishedData: { title: 'A' },
      }),
    )
    expect(
      plan.items.find((item) => item.id === 'entry:d1')?.summary,
    ).toMatchObject({
      preservedFields: ['excerpt'],
    })
  })

  it('lists every production entry of a removed collection as affected', () => {
    const plan = buildPlan(
      planInput({
        base: snapshot([withExcerpt]),
        dev: snapshot([]),
        production: snapshot([withExcerpt]),
        productionEntries: [
          prodEntry({ id: 'p1' }),
          prodEntry({ id: 'p2', slug: 'b', contentVersion: 5 }),
        ],
      }),
    )
    expect(
      plan.items.find((item) => item.id === 'schema:articles'),
    ).toMatchObject({
      kind: 'schema.remove',
      attention: 'drops-content',
      affectedEntries: [
        { id: 'p1', contentVersion: 3 },
        { id: 'p2', contentVersion: 5 },
      ],
    })
  })

  it('changes the plan hash when an affected production entry moves on', () => {
    const before = buildPlan(removalInput()).planHash
    const after = buildPlan(removalInput({ contentVersion: 4 })).planHash
    expect(after).not.toBe(before)
  })

  it('does not list a removed collection that production already disabled', () => {
    const disabled = { ...withExcerpt, enabled: false }
    const plan = buildPlan(
      planInput({
        base: snapshot([withExcerpt]),
        dev: snapshot([]),
        production: snapshot([disabled]),
      }),
    )
    expect(
      plan.items.find((item) => item.id === 'schema:articles')?.attention,
    ).toBeNull()
  })
})

describe('disabled production collections count as absent in dev', () => {
  const articles = def('articles')
  const disabled = { ...articles, enabled: false }

  it('does not count a disabled production collection the baseline does not have', () => {
    expect(
      productionChangeCount(
        planInput({
          base: snapshot([]),
          dev: snapshot([]),
          production: snapshot([disabled]),
        }),
      ),
    ).toBe(0)
  })

  it('counts a collection production disabled while the baseline still has it enabled', () => {
    expect(
      productionChangeCount(
        planInput({
          base: snapshot([articles]),
          dev: snapshot([articles]),
          production: snapshot([disabled]),
        }),
      ),
    ).toBe(1)
  })

  it('matches a collection dev does not have when production has it disabled', () => {
    expect(
      collectionsMatchProduction({
        dev: snapshot([]),
        production: snapshot([disabled]),
      }),
    ).toEqual({ articles: true })
  })
})

describe('buildPlan: a kept field is not a change of its own', () => {
  const withExcerpt = def('articles', [field('title'), field('excerpt')])
  const withoutExcerpt = def('articles', [field('title')])
  const baseline = {
    slug: 'a',
    data: { title: 'A', excerpt: 'Intro' },
    publishedSlug: 'a',
    publishedData: { title: 'A', excerpt: 'Intro' },
    status: 'published' as const,
  }
  const input = (dev: Partial<PlanEntry>) =>
    planInput({
      base: snapshot([withExcerpt]),
      dev: snapshot([withoutExcerpt]),
      production: snapshot([withExcerpt]),
      devEntries: [devEntry({ originBaseline: baseline, ...dev })],
      productionEntries: [
        prodEntry({
          draftData: { title: 'A', excerpt: 'Intro' },
          publishedData: { title: 'A', excerpt: 'Intro' },
        }),
      ],
      productionFieldUsage: { articles: { excerpt: 1 } },
    })

  it('does not list an entry whose only difference is the kept field', () => {
    const plan = buildPlan(
      input({
        draftData: { title: 'A' },
        publishedData: { title: 'A' },
      }),
    )
    expect(plan.items.map((item) => item.id)).toEqual(['schema:articles'])
  })

  it('lists an entry with another change, without the kept field among its changed fields', () => {
    const plan = buildPlan(
      input({
        draftData: { title: 'B' },
        publishedData: { title: 'B' },
      }),
    )
    const entryItem = plan.items.find((item) => item.id === 'entry:d1')
    expect(entryItem?.summary).toMatchObject({
      changedFields: ['title'],
      preservedFields: ['excerpt'],
    })
  })
})

describe('buildPlan: scheduled entries a destructive schema item touches', () => {
  const withExcerpt = def('articles', [field('title'), field('excerpt')])

  it('marks a removal with a scheduled affected entry as scheduled, with its title', () => {
    const plan = buildPlan(
      planInput({
        base: snapshot([withExcerpt]),
        dev: snapshot([]),
        production: snapshot([withExcerpt]),
        productionEntries: [
          prodEntry({ id: 'p1', scheduled: true, title: 'Spring offer' }),
          prodEntry({ id: 'p2', slug: 'b', title: 'Other' }),
        ],
      }),
    )
    const item = plan.items.find((entry) => entry.id === 'schema:articles')
    expect(item).toMatchObject({
      attention: 'scheduled',
      summary: expect.objectContaining({ scheduledTitles: ['Spring offer'] }),
    })
    expect(
      selectPlanItems(plan.items, { exclude: [], apply: [item!.id] }).selected,
    ).toEqual([])
  })

  it('marks a field removal whose affected entry is scheduled as scheduled', () => {
    const plan = buildPlan(
      planInput({
        base: snapshot([withExcerpt]),
        dev: snapshot([def('articles', [field('title')])]),
        production: snapshot([withExcerpt]),
        productionEntries: [
          prodEntry({
            scheduled: true,
            title: 'Spring offer',
            draftData: { title: 'A', excerpt: 'Intro' },
          }),
        ],
        productionFieldUsage: { articles: { excerpt: 1 } },
      }),
    )
    expect(
      plan.items.find((item) => item.id === 'schema:articles')?.attention,
    ).toBe('scheduled')
  })
})

describe('buildPlan: sections made again in dev', () => {
  const section = def('companyInfo', [field('email')], { kind: 'global' })
  const sectionEntry = (overrides: Partial<PlanEntry> = {}): PlanEntry =>
    devEntry({
      id: 's1',
      collectionKey: 'companyInfo',
      collectionKind: 'global',
      slug: '$global',
      title: 'Company info',
      draftData: { email: 'dev@example.test' },
      publishedSlug: null,
      publishedData: null,
      status: 'draft',
      originEntryId: null,
      originBaseline: null,
      originContentVersion: null,
      ...overrides,
    })
  const sectionProd = (
    overrides: Partial<PlanProductionEntry> = {},
  ): PlanProductionEntry =>
    prodEntry({
      id: 'ps1',
      collectionKey: 'companyInfo',
      collectionKind: 'global',
      slug: '$global',
      contentVersion: 2,
      status: 'published',
      title: 'Company info',
      draftData: { email: 'prod@example.test' },
      publishedData: { email: 'prod@example.test' },
      ...overrides,
    })
  const withSection = (overrides: Partial<PlanInput> = {}) =>
    planInput({
      base: snapshot([def('articles'), section]),
      dev: snapshot([def('articles'), section]),
      production: snapshot([def('articles'), section]),
      ...overrides,
    })

  it('lists an unlinked dev section matched by key to production as a conflict', () => {
    const plan = buildPlan(
      withSection({
        devEntries: [sectionEntry()],
        productionEntries: [sectionProd()],
      }),
    )
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]).toMatchObject({
      id: 'entry:s1',
      kind: 'entry.change',
      attention: 'conflict',
      productionId: 'ps1',
      productionContentVersion: 2,
    })
  })

  it('marks an unlinked section matched to a scheduled production section as scheduled', () => {
    const plan = buildPlan(
      withSection({
        devEntries: [sectionEntry()],
        productionEntries: [sectionProd({ scheduled: true })],
      }),
    )
    expect(plan.items[0]).toMatchObject({
      id: 'entry:s1',
      attention: 'scheduled',
    })
  })

  it('leaves an unlinked section alone when production has no section by that key', () => {
    const plan = buildPlan(
      withSection({
        devEntries: [sectionEntry()],
        productionEntries: [],
      }),
    )
    expect(plan.items).toEqual([])
  })

  it('applies the conflict only when the agency applies it', () => {
    const plan = buildPlan(
      withSection({
        devEntries: [sectionEntry()],
        productionEntries: [sectionProd()],
      }),
    )
    expect(
      selectPlanItems(plan.items, { exclude: [], apply: [] }).selected,
    ).toEqual([])
    expect(
      selectPlanItems(plan.items, {
        exclude: [],
        apply: ['entry:s1'],
      }).selected.map((item) => item.id),
    ).toEqual(['entry:s1'])
  })
})

describe('buildPlan: URLs another entry holds', () => {
  const newEntry = (overrides: Partial<PlanEntry> = {}): PlanEntry =>
    devEntry({
      id: 'n1',
      slug: 'fresh',
      title: 'Fresh',
      draftData: { title: 'Fresh' },
      publishedSlug: null,
      publishedData: null,
      status: 'draft',
      originEntryId: null,
      originBaseline: null,
      originContentVersion: null,
      ...overrides,
    })
  const localized = (locale: string, slug: string): EntryData => ({
    title: 'Localized',
    $i18n: { [locale]: { $slug: slug } },
  })

  it('flags a new entry whose main slug a production entry already uses', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [newEntry({ slug: 'contact' })],
        productionEntries: [
          prodEntry({ id: 'pc', slug: 'contact', title: 'Contact page' }),
        ],
      }),
    )
    expect(plan.items[0]).toMatchObject({
      id: 'entry:n1',
      kind: 'entry.new',
      attention: 'slug-taken',
      summary: {
        slugCollisions: [{ slug: 'contact', collidesWith: 'Contact page' }],
      },
    })
  })

  it('flags a changed entry whose localized slug another production entry uses in that language', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [
          devEntry({
            draftData: localized('nl', 'contact'),
            originBaseline: {
              slug: 'a',
              data: { title: 'A' },
              publishedSlug: 'a',
              publishedData: { title: 'A' },
              status: 'published',
            },
          }),
        ],
        productionEntries: [
          prodEntry({
            id: 'pc',
            slug: 'contact-page',
            title: 'Contact page',
            draftData: localized('nl', 'contact'),
          }),
          prodEntry(),
        ],
      }),
    )
    expect(plan.items[0]).toMatchObject({
      attention: 'slug-taken',
      summary: {
        slugCollisions: [
          { locale: 'nl', slug: 'contact', collidesWith: 'Contact page' },
        ],
      },
    })
  })

  it('flags a localized slug that another production entry uses as its main slug', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [newEntry({ draftData: localized('nl', 'contact') })],
        productionEntries: [
          prodEntry({ id: 'pc', slug: 'contact', title: 'Contact' }),
        ],
      }),
    )
    expect(plan.items[0]).toMatchObject({
      attention: 'slug-taken',
      summary: {
        slugCollisions: [
          { locale: 'nl', slug: 'contact', collidesWith: 'Contact' },
        ],
      },
    })
  })

  it('does not flag a localized slug another entry holds in a different language', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [newEntry({ draftData: localized('nl', 'contact') })],
        productionEntries: [
          prodEntry({
            id: 'pc',
            slug: 'other',
            draftData: localized('tr', 'contact'),
          }),
        ],
      }),
    )
    expect(plan.items[0]?.attention).toBeNull()
  })

  it('does not flag an entry against its own production entry', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [
          devEntry({
            title: 'A changed',
            draftData: { title: 'A changed', $i18n: { nl: { $slug: 'a-nl' } } },
          }),
        ],
        productionEntries: [prodEntry({ draftData: localized('nl', 'a-nl') })],
      }),
    )
    expect(plan.items[0]?.attention).toBeNull()
  })

  it('flags two entries in one push that want the same localized slug, on both', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [
          newEntry({
            id: 'na',
            slug: 'alpha',
            title: 'Alpha',
            draftData: localized('nl', 'kontakt'),
          }),
          newEntry({
            id: 'nb',
            slug: 'beta',
            title: 'Beta',
            draftData: localized('nl', 'kontakt'),
          }),
        ],
      }),
    )
    const byId = Object.fromEntries(plan.items.map((item) => [item.id, item]))
    expect(byId['entry:na']).toMatchObject({
      attention: 'slug-taken',
      summary: {
        slugCollisions: [
          { locale: 'nl', slug: 'kontakt', collidesWith: 'Beta' },
        ],
      },
    })
    expect(byId['entry:nb']).toMatchObject({
      attention: 'slug-taken',
      summary: {
        slugCollisions: [
          { locale: 'nl', slug: 'kontakt', collidesWith: 'Alpha' },
        ],
      },
    })
  })

  it('keeps a scheduled production entry as the reason over a URL collision', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [devEntry({ draftData: { title: 'B' } })],
        productionEntries: [
          prodEntry({ id: 'p1', slug: 'a', scheduled: true }),
          prodEntry({ id: 'px', slug: 'a', title: 'Other' }),
        ],
      }),
    )
    expect(plan.items[0]?.attention).toBe('scheduled')
  })

  it('never applies a URL collision, even when it is listed in apply', () => {
    const plan = buildPlan(
      planInput({
        devEntries: [newEntry({ slug: 'contact' })],
        productionEntries: [prodEntry({ id: 'pc', slug: 'contact' })],
      }),
    )
    const { selected } = selectPlanItems(plan.items, {
      exclude: [],
      apply: ['entry:n1'],
    })
    expect(selected).toEqual([])
  })

  it('changes the plan hash when the production entry that collides moves', () => {
    const input = planInput({
      devEntries: [newEntry({ slug: 'contact' })],
      productionEntries: [prodEntry({ id: 'pc', slug: 'other' })],
    })
    const before = buildPlan(input).planHash
    const after = buildPlan({
      ...input,
      productionEntries: [prodEntry({ id: 'pc', slug: 'contact' })],
    }).planHash
    expect(after).not.toBe(before)
  })
})

describe('productionChangeCount: forkable entries the dev env does not hold', () => {
  const section = def('companyInfo', [field('email')], { kind: 'global' })

  it('counts a ready production entry that no dev entry is linked to', () => {
    expect(
      productionChangeCount(
        planInput({
          productionEntries: [
            prodEntry({ id: 'px', slug: 'new', publishedData: { title: 'N' } }),
          ],
        }),
      ),
    ).toBe(1)
  })

  it('does not count an unready or archived production entry', () => {
    expect(
      productionChangeCount(
        planInput({
          productionEntries: [
            prodEntry({ id: 'pu', slug: 'draft', publishedData: null }),
            prodEntry({
              id: 'pa',
              slug: 'old',
              status: 'archived',
              publishedData: { title: 'Old' },
            }),
          ],
        }),
      ),
    ).toBe(0)
  })

  it('counts a production section with no dev section linked to it', () => {
    expect(
      productionChangeCount({
        ...planInput({
          base: snapshot([def('articles'), section]),
          dev: snapshot([def('articles'), section]),
          production: snapshot([def('articles'), section]),
          productionEntries: [
            prodEntry({
              id: 'ps',
              collectionKey: 'companyInfo',
              collectionKind: 'global',
              slug: '$global',
              publishedData: null,
            }),
          ],
        }),
      }),
    ).toBe(1)
  })

  it('does not count an entry a dev entry is linked to', () => {
    expect(
      productionChangeCount(
        planInput({
          devEntries: [devEntry({ originEntryId: 'p1' })],
          productionEntries: [
            prodEntry({ id: 'p1', publishedData: { title: 'A' } }),
          ],
        }),
      ),
    ).toBe(0)
  })

  it('does not count the entries of a disabled collection that dev and the baseline both lack', () => {
    const cases = def('cases', [field('title')], { enabled: false })
    expect(
      productionChangeCount(
        planInput({
          base: snapshot([def('articles')]),
          dev: snapshot([def('articles')]),
          production: snapshot([def('articles'), cases]),
          productionEntries: [
            prodEntry({
              id: 'pc',
              collectionKey: 'cases',
              slug: 'case-1',
              publishedData: { title: 'C' },
            }),
          ],
        }),
      ),
    ).toBe(0)
  })

  it('counts a ready entry of a collection dev does not have, as a reset would copy it', () => {
    const cases = def('cases')
    expect(
      productionChangeCount(
        planInput({
          base: snapshot([def('articles'), cases]),
          dev: snapshot([def('articles')]),
          production: snapshot([def('articles'), cases]),
          productionEntries: [
            prodEntry({
              id: 'pc',
              collectionKey: 'cases',
              slug: 'case-1',
              publishedData: { title: 'C' },
            }),
            prodEntry({
              id: 'pca',
              collectionKey: 'cases',
              slug: 'case-old',
              status: 'archived',
              publishedData: { title: 'Old' },
            }),
            prodEntry({
              id: 'pcu',
              collectionKey: 'cases',
              slug: 'case-draft',
              publishedData: null,
            }),
          ],
        }),
      ),
    ).toBe(1)
  })
})

describe('buildPlan: languages item title code', () => {
  it('gives the languages item a title code the UI translates', () => {
    const plan = buildPlan(
      planInput({
        base: { languages: { main: 'en', all: ['en'] }, collections: [] },
        dev: { languages: { main: 'en', all: ['en', 'nl'] }, collections: [] },
        production: {
          languages: { main: 'en', all: ['en'] },
          collections: [],
        },
        stampCount: 0,
      }),
    )
    expect(plan.items).toEqual([
      expect.objectContaining({
        id: 'languages',
        title: 'Site languages',
        titleCode: 'site-languages',
      }),
    ])
  })
})

describe('buildPlan: blank production values a pending removal keeps', () => {
  const withExcerpt = def('articles', [field('title'), field('excerpt')])
  const withoutExcerpt = def('articles', [field('title')])
  const blankBaseline = {
    slug: 'a',
    data: { title: 'A', excerpt: '' },
    publishedSlug: 'a',
    publishedData: { title: 'A', excerpt: '' },
    status: 'published' as const,
  }

  // Production holds `excerpt: ""`, which is not content: no field usage counts it.
  function blankInput(devOverrides: Partial<PlanEntry> = {}) {
    return planInput({
      base: snapshot([withExcerpt]),
      dev: snapshot([withoutExcerpt]),
      production: snapshot([withExcerpt]),
      devEntries: [
        devEntry({
          draftData: { title: 'A' },
          publishedData: { title: 'A' },
          originBaseline: blankBaseline,
          ...devOverrides,
        }),
      ],
      productionEntries: [
        prodEntry({
          draftData: { title: 'A', excerpt: '' },
          publishedData: { title: 'A', excerpt: '' },
        }),
      ],
      productionFieldUsage: {},
    })
  }

  it('keeps a blank production value, so the entry is linked to the removal', () => {
    const plan = buildPlan(
      blankInput({
        draftData: { title: 'B' },
        publishedData: { title: 'B' },
      }),
    )
    const entryItem = plan.items.find((item) => item.id === 'entry:d1')
    expect(entryItem).toMatchObject({
      dependsOn: ['schema:articles'],
      summary: expect.objectContaining({ preservedFields: ['excerpt'] }),
    })
    expect(entryItem?.summary.changedFields).toEqual(['title'])
  })

  it('does not list an entry whose only difference is the blank kept field', () => {
    const plan = buildPlan(blankInput())
    expect(plan.items.map((item) => item.id)).toEqual(['schema:articles'])
  })
})

describe('buildPlan: turning SEO off on a section', () => {
  const section = (seoEnabled: boolean) =>
    def('companyInfo', [field('email')], { kind: 'global', seoEnabled })
  const sectionRow = (contentVersion: number, extra = {}) =>
    prodEntry({
      id: 'ps',
      collectionKey: 'companyInfo',
      collectionKind: 'global',
      slug: '$global',
      contentVersion,
      draftData: { email: 'a@x.test', $seo: { title: 'Home' } },
      ...extra,
    })
  const seoOff = (row: PlanProductionEntry) =>
    planInput({
      base: snapshot([section(true)]),
      dev: snapshot([section(false)]),
      production: snapshot([section(true)]),
      productionEntries: [row],
    })

  it('lists the section entry as affected, at the version the plan saw', () => {
    const plan = buildPlan(seoOff(sectionRow(2)))
    expect(
      plan.items.find((item) => item.id === 'schema:companyInfo'),
    ).toMatchObject({
      attention: null,
      affectedEntries: [{ id: 'ps', contentVersion: 2 }],
    })
  })

  it('changes the plan hash when the section moves on after planning', () => {
    const before = buildPlan(seoOff(sectionRow(2))).planHash
    const after = buildPlan(seoOff(sectionRow(3))).planHash
    expect(after).not.toBe(before)
  })

  it('marks the item scheduled when the section has a schedule', () => {
    const plan = buildPlan(
      seoOff(sectionRow(2, { scheduled: true, title: 'Home' })),
    )
    expect(
      plan.items.find((item) => item.id === 'schema:companyInfo'),
    ).toMatchObject({
      attention: 'scheduled',
      summary: expect.objectContaining({ scheduledTitles: ['Home'] }),
    })
  })

  it('affects nothing when SEO stays on', () => {
    const plan = buildPlan(
      planInput({
        base: snapshot([section(true)]),
        dev: snapshot([{ ...section(true), label: 'Renamed' }]),
        production: snapshot([section(true)]),
        productionEntries: [sectionRow(2)],
      }),
    )
    expect(
      plan.items.find((item) => item.id === 'schema:companyInfo')
        ?.affectedEntries,
    ).toBeUndefined()
  })
})

describe('buildPlan: the rows a main-language stamp rewrites', () => {
  const base = snapshot([def('articles')], { main: 'en', all: ['en', 'nl'] })
  const switchTo = (
    rows: PlanProductionEntry[],
    production: PlanInput['production']['languages'] = {
      main: 'en',
      all: ['en', 'nl'],
    },
  ) =>
    planInput({
      base,
      dev: snapshot([def('articles')], { main: 'nl', all: ['en', 'nl'] }),
      production: snapshot([def('articles')], production),
      productionEntries: rows,
    })
  const stamped = {
    draftData: { $locale: 'en', title: 'Stamped' },
    publishedData: { $locale: 'en', title: 'Stamped' },
    scheduledData: null,
  }

  it('lists every row whose draft, ready or scheduled version lacks $locale, in id order', () => {
    const plan = buildPlan(
      switchTo([
        prodEntry({
          id: 'p2',
          contentVersion: 5,
          draftData: { title: 'No locale' },
        }),
        prodEntry({
          id: 'p1',
          contentVersion: 3,
          draftData: { $locale: 'en', title: 'Draft only' },
          publishedData: { title: 'Ready without locale' },
        }),
        prodEntry({ id: 'p3', contentVersion: 7, ...stamped }),
      ]),
    )
    expect(plan.items.find((item) => item.id === 'languages')).toMatchObject({
      attention: 'main-language',
      affectedEntries: [
        { id: 'p1', contentVersion: 3 },
        { id: 'p2', contentVersion: 5 },
      ],
    })
  })

  it('lists a row with a scheduled version that lacks $locale', () => {
    const plan = buildPlan(
      switchTo([
        prodEntry({
          id: 'p1',
          contentVersion: 3,
          draftData: { $locale: 'en' },
          scheduledData: { title: 'Later' },
        }),
      ]),
    )
    expect(
      plan.items.find((item) => item.id === 'languages')?.affectedEntries,
    ).toEqual([{ id: 'p1', contentVersion: 3 }])
  })

  it('lists nothing when production already has the new main language', () => {
    const plan = buildPlan(
      switchTo([prodEntry({ id: 'p1', draftData: { title: 'No locale' } })], {
        main: 'nl',
        all: ['en', 'nl'],
      }),
    )
    expect(
      plan.items.find((item) => item.id === 'languages')?.affectedEntries,
    ).toBeUndefined()
  })

  it('marks the item scheduled when a row it stamps is scheduled', () => {
    const plan = buildPlan(
      switchTo([
        prodEntry({
          id: 'p1',
          title: 'Spring menu',
          scheduled: true,
          draftData: { title: 'No locale' },
        }),
      ]),
    )
    expect(plan.items.find((item) => item.id === 'languages')).toMatchObject({
      attention: 'scheduled',
      summary: expect.objectContaining({ scheduledTitles: ['Spring menu'] }),
    })
  })

  it('changes the plan hash when a row the stamp touches moves on', () => {
    const rows = (version: number) => [
      prodEntry({
        id: 'p1',
        contentVersion: version,
        draftData: { title: 'No locale' },
      }),
    ]
    expect(buildPlan(switchTo(rows(4))).planHash).not.toBe(
      buildPlan(switchTo(rows(5))).planHash,
    )
  })
})
