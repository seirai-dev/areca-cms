import { describe, expect, it } from 'vitest'

import type {
  PlanAttention,
  PlanItem,
  PlanItemKind,
} from '#/server/dev-env/plan'

import {
  applyAllowed,
  attentionReasonOf,
  carryPushDecisions,
  decisionOf,
  groupPushItems,
  isPushTaken,
  planItemFingerprint,
  planItemLabel,
  pluralForm,
  pushDetailsOf,
  pushGroupOf,
  pushSelection,
  schemaActionOf,
  summarizePushItem,
  withId,
} from './push-model'

function item(
  id: string,
  kind: PlanItemKind,
  attention: PlanAttention = null,
  summary: PlanItem['summary'] = {},
): PlanItem {
  return {
    id,
    kind,
    title: id,
    collectionKey: 'pages',
    summary,
    devChanged: true,
    productionChanged: attention !== null,
    attention,
  }
}

describe('groupPushItems', () => {
  it('puts attention first, then schema, languages, new, changed, archived', () => {
    const items = [
      item('entry:archive', 'entry.archive'),
      item('entry:change', 'entry.change'),
      item('entry:new', 'entry.new'),
      item('languages', 'languages'),
      item('schema:offers', 'schema.add'),
      item('entry:conflict', 'entry.change', 'conflict'),
    ]
    expect(groupPushItems(items).map((group) => group.key)).toEqual([
      'attention',
      'schema',
      'languages',
      'new',
      'changed',
      'archived',
    ])
  })

  it('hides empty groups and keeps the plan order inside a group', () => {
    const items = [
      item('entry:b', 'entry.change'),
      item('entry:a', 'entry.change'),
    ]
    const groups = groupPushItems(items)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.items.map((row) => row.id)).toEqual([
      'entry:b',
      'entry:a',
    ])
  })

  it('returns no groups for an empty plan', () => {
    expect(groupPushItems([])).toEqual([])
  })

  it('moves a schema removal needing attention into the attention group', () => {
    const removal = item('schema:old', 'schema.remove', 'drops-content')
    expect(pushGroupOf(removal)).toBe('attention')
  })
})

describe('pushSelection', () => {
  const items = [
    item('schema:offers', 'schema.add'),
    item('entry:new', 'entry.new'),
    item('entry:conflict', 'entry.change', 'conflict'),
    item('entry:scheduled', 'entry.change', 'scheduled'),
  ]

  it('ticks every normal row and skips every attention row by default', () => {
    const selection = pushSelection(items, { unticked: [], applied: [] })
    expect(selection.push).toBe(2)
    expect(selection.skipped).toBe(2)
    expect(selection.exclude).toEqual(['entry:conflict', 'entry:scheduled'])
    expect(selection.apply).toEqual([])
  })

  it('excludes an unticked normal row and counts it as skipped', () => {
    const selection = pushSelection(items, {
      unticked: ['entry:new'],
      applied: [],
    })
    expect(selection.push).toBe(1)
    expect(selection.skipped).toBe(3)
    expect(selection.exclude).toContain('entry:new')
  })

  it('applies a Needs-attention row that is switched to Apply', () => {
    const selection = pushSelection(items, {
      unticked: [],
      applied: ['entry:conflict'],
    })
    expect(selection.push).toBe(3)
    expect(selection.apply).toEqual(['entry:conflict'])
    expect(selection.exclude).toEqual(['entry:scheduled'])
  })

  it('never applies a scheduled production entry', () => {
    const decisions = { unticked: [], applied: ['entry:scheduled'] }
    const scheduled = item('entry:scheduled', 'entry.change', 'scheduled')
    expect(isPushTaken(scheduled, decisions)).toBe(false)
    expect(pushSelection(items, decisions).apply).toEqual([])
  })

  it('pushes nothing when every row is unticked', () => {
    const selection = pushSelection(items, {
      unticked: ['schema:offers', 'entry:new'],
      applied: [],
    })
    expect(selection.push).toBe(0)
  })
})

describe('withId', () => {
  it('adds an id once and removes it again', () => {
    expect(withId([], 'a', true)).toEqual(['a'])
    expect(withId(['a'], 'a', true)).toEqual(['a'])
    expect(withId(['a', 'b'], 'a', false)).toEqual(['b'])
  })
})

describe('planItemLabel', () => {
  it('joins an entry title and its collection label with a middle dot', () => {
    expect(
      planItemLabel({
        ...item('entry:1', 'entry.change'),
        title: 'Spring menu',
        collectionLabel: 'Articles',
      }),
    ).toBe('Spring menu · Articles')
  })

  it('shows only the title when there is no collection label', () => {
    expect(
      planItemLabel({
        ...item('schema:offers', 'schema.add'),
        title: 'Offers',
      }),
    ).toBe('Offers')
  })
})

describe('pluralForm', () => {
  it('uses the singular only for exactly one', () => {
    expect(pluralForm(0)).toBe('other')
    expect(pluralForm(1)).toBe('one')
    expect(pluralForm(2)).toBe('other')
  })
})

describe('summarizePushItem', () => {
  it('describes an entry change by its changed fields and scope', () => {
    const row = item('entry:home', 'entry.change', null, {
      changedFields: ['title', 'body', 'hero'],
      readyChanged: true,
      draftChanged: true,
    })
    expect(summarizePushItem(row)).toEqual({
      kind: 'fields',
      fields: 3,
      scope: 'both',
    })
  })

  it('reports ready only or draft only', () => {
    const ready = item('entry:a', 'entry.change', null, { readyChanged: true })
    const draft = item('entry:b', 'entry.change', null, { draftChanged: true })
    expect(summarizePushItem(ready)).toEqual({
      kind: 'fields',
      fields: 0,
      scope: 'ready',
    })
    expect(summarizePushItem(draft)).toEqual({
      kind: 'fields',
      fields: 0,
      scope: 'draft',
    })
  })

  it('falls back to a plain summary when nothing is known', () => {
    expect(summarizePushItem(item('entry:c', 'entry.change'))).toEqual({
      kind: 'plain',
    })
  })

  it('counts the values a removal drops', () => {
    const removal = item('schema:old', 'schema.remove', null, {
      droppedFields: [
        { key: 'hero', values: 3 },
        { key: 'lead', values: 1 },
      ],
    })
    expect(summarizePushItem(removal)).toEqual({ kind: 'drops', values: 4 })
  })

  it('describes a removal with no values as a plain removal', () => {
    expect(
      summarizePushItem(item('schema:old', 'schema.remove', null, {})),
    ).toEqual({ kind: 'schema-remove' })
  })
})

describe('attentionReasonOf', () => {
  it('is null for a normal row', () => {
    expect(attentionReasonOf(item('entry:a', 'entry.change'))).toBeNull()
  })

  it('names the dropped fields; the values are a detail line', () => {
    const removal = item('schema:old', 'schema.change', 'drops-content', {
      droppedFields: [{ key: 'hero', values: 4 }],
    })
    expect(attentionReasonOf(removal)).toEqual({
      kind: 'drops',
      fields: ['hero'],
    })
  })

  it('reads a removed collection as a collection removal', () => {
    const removal = item('schema:old', 'schema.remove', 'drops-content')
    expect(attentionReasonOf(removal)).toEqual({ kind: 'remove-collection' })
  })

  it('carries the stamp count of a main-language change', () => {
    const language = item('languages', 'languages', 'main-language', {
      stampCount: 12,
    })
    expect(attentionReasonOf(language)).toEqual({
      kind: 'main-language',
      entries: 12,
    })
  })

  it('maps the remaining attention kinds', () => {
    expect(
      attentionReasonOf(item('entry:a', 'entry.change', 'conflict')),
    ).toEqual({ kind: 'conflict' })
    expect(
      attentionReasonOf(item('entry:b', 'entry.change', 'scheduled')),
    ).toEqual({ kind: 'scheduled', titles: [] })
    expect(
      attentionReasonOf(item('entry:c', 'entry.new', 'deleted-in-production')),
    ).toEqual({ kind: 'deleted-in-production' })
  })
})

describe('carryPushDecisions', () => {
  const reviewed = [
    item('entry:a', 'entry.change', null, { changedFields: ['title'] }),
    item('entry:b', 'entry.change', 'conflict'),
    item('entry:c', 'entry.new'),
  ]

  it('keeps decisions while every item is unchanged', () => {
    const carried = carryPushDecisions(reviewed, [...reviewed], {
      unticked: ['entry:a'],
      applied: ['entry:b'],
    })
    expect(carried.changed).toEqual([])
    expect(carried.decisions).toEqual({
      unticked: ['entry:a'],
      applied: ['entry:b'],
    })
  })

  it('resets the decision of a changed item and lists it as changed', () => {
    const next = [
      item('entry:a', 'entry.change', null, { changedFields: ['title', 'x'] }),
      reviewed[1],
      reviewed[2],
    ]
    const carried = carryPushDecisions(reviewed, next, {
      unticked: ['entry:a', 'entry:c'],
      applied: ['entry:b'],
    })
    expect(carried.changed).toEqual(['entry:a'])
    expect(carried.decisions).toEqual({
      unticked: ['entry:c'],
      applied: ['entry:b'],
    })
  })

  it('treats a changed production version or attention as a change', () => {
    const versioned = { ...reviewed[1], productionContentVersion: 7 }
    expect(
      carryPushDecisions(reviewed, [reviewed[0], versioned, reviewed[2]], {
        unticked: [],
        applied: ['entry:b'],
      }),
    ).toEqual({
      decisions: { unticked: [], applied: [] },
      changed: ['entry:b'],
    })
    const scheduled = item('entry:b', 'entry.change', 'scheduled')
    expect(
      carryPushDecisions(reviewed, [reviewed[0], scheduled, reviewed[2]], {
        unticked: [],
        applied: ['entry:b'],
      }).changed,
    ).toEqual(['entry:b'])
  })

  it('drops decisions of items that left the plan, and lists new items as changed', () => {
    const next = [reviewed[0], item('entry:d', 'entry.new')]
    const carried = carryPushDecisions(reviewed, next, {
      unticked: ['entry:c'],
      applied: ['entry:b'],
    })
    expect(carried.changed).toEqual(['entry:d'])
    expect(carried.decisions).toEqual({ unticked: [], applied: [] })
  })

  it('changes nothing before the first plan is reviewed', () => {
    const carried = carryPushDecisions(null, reviewed, {
      unticked: ['entry:a'],
      applied: [],
    })
    expect(carried.changed).toEqual([])
    expect(carried.decisions.unticked).toEqual(['entry:a'])
  })
})

describe('planItemFingerprint', () => {
  it('ignores key order inside the summary', () => {
    const a = item('entry:a', 'entry.change', null, {
      changedFields: ['x'],
      draftChanged: true,
    })
    const b = item('entry:a', 'entry.change', null, {
      draftChanged: true,
      changedFields: ['x'],
    })
    expect(planItemFingerprint(a)).toBe(planItemFingerprint(b))
  })
})

describe('pushDetailsOf', () => {
  it('lists the fields an entry keeps in production', () => {
    const changed = item('entry:a', 'entry.change', null, {
      preservedFields: ['excerpt'],
    })
    expect(pushDetailsOf(changed)).toEqual([
      { kind: 'keeps', fields: ['excerpt'] },
    ])
  })

  it('counts the values and entries a destructive schema item archives', () => {
    const field = {
      ...item('schema:news', 'schema.change', 'drops-content', {
        droppedFields: [{ key: 'hero', values: 4 }],
      }),
      affectedEntries: [
        { id: 'p1', contentVersion: 1 },
        { id: 'p2', contentVersion: 1 },
      ],
    }
    expect(pushDetailsOf(field)).toEqual([
      { kind: 'archives', values: 4, entries: 2 },
    ])
    const collection = {
      ...item('schema:old', 'schema.remove', 'drops-content'),
      affectedEntries: [{ id: 'p1', contentVersion: 1 }],
    }
    expect(pushDetailsOf(collection)).toEqual([
      { kind: 'archives', values: null, entries: 1 },
    ])
  })

  it('leaves the scheduled titles to the reason, not a second line', () => {
    const blocked = item('schema:menu', 'schema.change', 'scheduled', {
      scheduledTitles: ['Spring menu'],
    })
    expect(pushDetailsOf(blocked)).toEqual([])
    expect(attentionReasonOf(blocked)).toEqual({
      kind: 'scheduled',
      titles: ['Spring menu'],
    })
  })

  it('has no details for a plain row', () => {
    expect(pushDetailsOf(item('entry:a', 'entry.change'))).toEqual([])
  })
})

const NO_DECISIONS = { unticked: [], applied: [] }

describe('applyAllowed', () => {
  it('never allows a scheduled or slug-taken item to be applied', () => {
    expect(applyAllowed(item('entry:a', 'entry.change', 'scheduled'))).toBe(
      false,
    )
    expect(applyAllowed(item('entry:b', 'entry.change', 'slug-taken'))).toBe(
      false,
    )
  })

  it('allows the other attention items to be applied', () => {
    for (const attention of [
      'conflict',
      'drops-content',
      'main-language',
      'deleted-in-production',
    ] as const) {
      expect(applyAllowed(item('x', 'entry.change', attention))).toBe(true)
    }
  })

  it('has no Apply for a normal row', () => {
    expect(applyAllowed(item('entry:a', 'entry.change'))).toBe(false)
  })
})

describe('decisionOf', () => {
  it('shows Apply disabled and Skip for a slug-taken row, even when it was switched to Apply', () => {
    const slug = item('entry:a', 'entry.change', 'slug-taken')
    expect(decisionOf(slug, { unticked: [], applied: ['entry:a'] })).toEqual({
      value: 'skip',
      applyDisabled: true,
    })
  })

  it('shows Apply disabled for a scheduled row', () => {
    const scheduled = item('entry:a', 'entry.change', 'scheduled')
    expect(decisionOf(scheduled, NO_DECISIONS)).toEqual({
      value: 'skip',
      applyDisabled: true,
    })
  })

  it('leaves Apply enabled for a conflict and shows Apply when chosen', () => {
    const conflict = item('entry:a', 'entry.change', 'conflict')
    expect(decisionOf(conflict, NO_DECISIONS)).toEqual({
      value: 'skip',
      applyDisabled: false,
    })
    expect(
      decisionOf(conflict, { unticked: [], applied: ['entry:a'] }),
    ).toEqual({ value: 'apply', applyDisabled: false })
  })
})

describe('slug-taken rows', () => {
  it('are never pushed, even when they are in applied', () => {
    const slug = item('entry:a', 'entry.change', 'slug-taken')
    expect(isPushTaken(slug, { unticked: [], applied: ['entry:a'] })).toBe(
      false,
    )
    const selection = pushSelection([slug], {
      unticked: [],
      applied: ['entry:a'],
    })
    expect(selection.apply).toEqual([])
    expect(selection.push).toBe(0)
  })
})

describe('schemaActionOf', () => {
  it('reads each schema kind and a field removal that holds values', () => {
    expect(schemaActionOf(item('schema:a', 'schema.add'))).toEqual({
      kind: 'add-collection',
    })
    expect(schemaActionOf(item('schema:a', 'schema.remove'))).toEqual({
      kind: 'remove-collection',
    })
    expect(schemaActionOf(item('schema:a', 'schema.change'))).toEqual({
      kind: 'change-collection',
    })
    expect(
      schemaActionOf(
        item('schema:a', 'schema.change', 'drops-content', {
          droppedFields: [{ key: 'excerpt', values: 3 }],
        }),
      ),
    ).toEqual({ kind: 'remove-fields', fields: ['excerpt'] })
  })

  it('is null for entry and language rows', () => {
    expect(schemaActionOf(item('entry:a', 'entry.change'))).toBeNull()
    expect(schemaActionOf(item('languages', 'languages'))).toBeNull()
  })
})
