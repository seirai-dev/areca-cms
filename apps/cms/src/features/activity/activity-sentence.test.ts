import { describe, expect, it } from 'vitest'

import {
  activityScope,
  activityText,
  collapseRepeats,
  entryTargetIds,
} from './activity-sentence'
import type { ActivityLike } from './activity-sentence'

function row(partial: Partial<ActivityLike>): ActivityLike {
  return {
    id: Math.random().toString(36),
    action: 'entry.update',
    targetType: 'entry',
    targetId: 'e1',
    actorId: 'u1',
    actorName: 'Sanne de Vries',
    organizationName: 'Acme',
    siteName: 'Acme Website',
    meta: null,
    createdAt: '2026-09-30T10:00:00Z',
    ...partial,
  }
}

describe('activityText', () => {
  it('uses the new vocabulary and the entry title', () => {
    expect(
      activityText(row({ action: 'entry.publish' }), 'Spring launch'),
    ).toBe('Sanne de Vries marked “Spring launch” as ready')
    expect(activityText(row({ action: 'entry.unpublish' }), 'Spring')).toBe(
      'Sanne de Vries moved “Spring” back to draft',
    )
  })

  it('falls back to the slug, then to a generic word', () => {
    expect(
      activityText(row({ action: 'entry.delete', meta: { slug: 'old-news' } })),
    ).toBe('Sanne de Vries deleted “Old news”')
    expect(activityText(row({ action: 'entry.create' }))).toBe(
      'Sanne de Vries created an entry',
    )
  })

  it('tells site events without an actor', () => {
    expect(
      activityText(
        row({ action: 'publication.live', targetType: 'publication' }),
      ),
    ).toBe('Acme Website went live')
    expect(
      activityText(
        row({ action: 'publication.failed', targetType: 'publication' }),
      ),
    ).toBe("Acme Website couldn't go live")
  })

  it('names clients, people and system actors plainly', () => {
    expect(
      activityText(
        row({ action: 'organization.create', targetType: 'organization' }),
      ),
    ).toBe('Sanne de Vries added the client Acme')
    expect(
      activityText(
        row({
          action: 'member.invite',
          targetType: 'invitation',
          meta: { email: 'ada@example.com' },
        }),
      ),
    ).toBe('Sanne de Vries invited ada@example.com')
    expect(
      activityText(
        row({
          action: 'site.rotate_token',
          targetType: 'site',
          actorId: null,
          actorName: null,
        }),
      ),
    ).toBe('Made a new site token for Acme Website')
  })
})

describe('collapseRepeats', () => {
  it('folds consecutive saves by the same person on the same entry', () => {
    const rows = [
      row({ createdAt: '2026-09-30T10:10:00Z' }),
      row({ createdAt: '2026-09-30T10:05:00Z' }),
      row({ createdAt: '2026-09-30T10:00:00Z' }),
      row({ createdAt: '2026-09-30T09:00:00Z' }),
      row({ targetId: 'e2', createdAt: '2026-09-30T08:59:00Z' }),
    ]
    expect(collapseRepeats(rows).map((group) => group.count)).toEqual([3, 1, 1])
  })
})

describe('entryTargetIds', () => {
  it('skips deleted entries and duplicates', () => {
    expect(
      entryTargetIds([
        row({}),
        row({}),
        row({ targetId: 'e2', action: 'entry.delete' }),
        row({ targetType: 'site', targetId: 's1' }),
      ]),
    ).toEqual(['e1'])
  })
})

describe('activityScope', () => {
  it('drops the client when the site name already says it', () => {
    expect(
      activityScope({ organizationName: 'Acme', siteName: 'Acme Website' }),
    ).toBe('Acme Website')
    expect(
      activityScope({
        organizationName: 'Northwind Studio',
        siteName: 'Northwind Journal',
      }),
    ).toBe('Northwind Studio · Northwind Journal')
    expect(activityScope({ organizationName: 'Acme', siteName: null })).toBe(
      'Acme',
    )
  })
})
