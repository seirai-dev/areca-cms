import { describe, expect, it } from 'vitest'

import type {
  PlanAttention,
  PlanItem,
  PlanItemKind,
} from '#/server/dev-env/plan'

import {
  attentionReasonOf,
  groupPushItems,
  isPushTaken,
  pluralForm,
  pushGroupOf,
  pushSelection,
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
    label: id,
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

  it('lists the dropped fields and their values', () => {
    const removal = item('schema:old', 'schema.remove', 'drops-content', {
      droppedFields: [{ key: 'hero', values: 4 }],
    })
    expect(attentionReasonOf(removal)).toEqual({
      kind: 'drops',
      fields: ['hero'],
      values: 4,
    })
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
    ).toEqual({ kind: 'scheduled' })
    expect(
      attentionReasonOf(item('entry:c', 'entry.new', 'deleted-in-production')),
    ).toEqual({ kind: 'deleted-in-production' })
  })
})
