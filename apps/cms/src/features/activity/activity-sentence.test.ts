import { describe, expect, it } from 'vitest'

import {
  activityScope,
  activityText,
  collapseRepeats,
  entryTargetIds,
  viaMcpKey,
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

describe('activityText for people actions', () => {
  it('names the person a block, unblock, deletion, rename, sign-out or 2FA reset is about', () => {
    expect(
      activityText(
        row({
          action: 'user.block',
          targetType: 'user',
          meta: { userName: 'Jane Doe', reason: 'x' },
        }),
      ),
    ).toBe('Sanne de Vries blocked Jane Doe')
    expect(
      activityText(
        row({
          action: 'user.delete',
          targetType: 'user',
          meta: { deletedUserName: 'Jane Doe', self: false },
        }),
      ),
    ).toBe('Sanne de Vries deleted the account of Jane Doe')
    expect(
      activityText(
        row({ action: 'user.sessions_revoke', targetType: 'user', meta: {} }),
      ),
    ).toBe('Sanne de Vries signed someone out everywhere')
    expect(
      activityText(
        row({ action: 'user.two_factor_reset', targetType: 'user', meta: {} }),
      ),
    ).toBe('Sanne de Vries reset two-factor sign-in for someone')
  })

  it('says a person was added to a client, by their e-mail when the name was not kept', () => {
    expect(
      activityText(
        row({
          action: 'member.add',
          targetType: 'membership',
          meta: { email: 'pia@example.com', direct: true },
        }),
      ),
    ).toBe('Sanne de Vries added pia@example.com to Acme')
  })

  it('names the person, client and role when a person is added to a client', () => {
    expect(
      activityText(
        row({
          action: 'member.add',
          targetType: 'membership',
          organizationName: 'Kade Bakery',
          meta: {
            userName: 'Tom Peeters',
            email: 'tom@harbourdental.example',
            role: 'editor',
            direct: true,
          },
        }),
      ),
    ).toBe('Sanne de Vries added Tom Peeters to Kade Bakery as Editor')
  })

  it('says someone was given a role in a client, by name, with the new role', () => {
    expect(
      activityText(
        row({
          action: 'member.update_role',
          targetType: 'membership',
          organizationName: 'Kade Bakery',
          meta: {
            userId: 'u2',
            userName: 'Tom Peeters',
            role: 'owner',
            previousRole: 'editor',
          },
        }),
      ),
    ).toBe(
      'Sanne de Vries changed the role of Tom Peeters in Kade Bakery to Owner',
    )
  })

  it('keeps the role change readable for older rows that have no name', () => {
    expect(
      activityText(
        row({
          action: 'member.update_role',
          targetType: 'membership',
          organizationName: 'Kade Bakery',
          meta: { userId: 'u2', role: 'editor', previousRole: 'owner' },
        }),
      ),
    ).toBe("Sanne de Vries changed a member's role in Kade Bakery to Editor")
  })

  it('falls back to the generic role wording when the row has no role', () => {
    expect(
      activityText(
        row({
          action: 'member.update_role',
          targetType: 'membership',
          meta: { userId: 'u2' },
        }),
      ),
    ).toBe('Sanne de Vries changed the role of someone')
  })

  it('says a sign-in in plain words', () => {
    expect(
      activityText(
        row({ action: 'user.sign_in', targetType: 'user', targetId: 'u1' }),
      ),
    ).toBe('Sanne de Vries signed in')
  })

  it('says a rename with the names it had and got, not the current name', () => {
    expect(
      activityText(
        row({
          action: 'user.rename',
          targetType: 'user',
          targetId: 'u9',
          meta: {
            previousName: 'Lucas de Vries',
            userName: 'Lucas de Vries-Bos',
          },
        }),
      ),
    ).toBe('Sanne de Vries renamed Lucas de Vries to Lucas de Vries-Bos')
  })

  it('uses the generic rename wording for older rows without the old name', () => {
    expect(
      activityText(
        row({
          action: 'user.rename',
          targetType: 'user',
          targetId: 'u9',
          meta: { userName: 'Lucas de Vries-Bos' },
        }),
      ),
    ).toBe('Sanne de Vries changed the name of Lucas de Vries-Bos')
  })

  it('keeps the name of an actor who has since been deleted, from the row itself', () => {
    expect(
      activityText(
        row({
          action: 'user.delete',
          targetType: 'user',
          actorId: null,
          actorName: null,
          meta: { deletedUserName: 'Jane Doe', actorName: 'Owen Admin' },
        }),
      ),
    ).toBe('Owen Admin deleted the account of Jane Doe')
  })
})

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

  it('counts the autosaves a shared row holds, and groups from its first save', () => {
    const rows = [
      row({
        createdAt: '2026-09-30T11:00:00Z',
        meta: { saves: 12, firstSavedAt: '2026-09-30T10:05:00Z' },
      }),
      row({ createdAt: '2026-09-30T10:00:00Z' }),
      row({ createdAt: '2026-09-30T09:00:00Z', meta: { saves: 1 } }),
    ]
    expect(collapseRepeats(rows).map((group) => group.count)).toEqual([13, 1])
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

describe('MCP keys in the activity log', () => {
  it('names the key a revoke or create touched', () => {
    expect(
      activityText(
        row({
          action: 'mcp_key.create',
          targetType: 'mcp_key',
          meta: { name: 'Laptop' },
        }),
      ),
    ).toBe('Sanne de Vries created the AI key Laptop')
    expect(
      activityText(
        row({
          action: 'mcp_key.revoke',
          targetType: 'mcp_key',
          meta: { name: 'Laptop' },
        }),
      ),
    ).toBe('Sanne de Vries revoked the AI key Laptop')
  })

  it('names the AI app connected or disconnected on a site', () => {
    expect(
      activityText(
        row({
          action: 'mcp_connection.create',
          targetType: 'mcp_connection',
          meta: { clientName: 'Claude', allowGoLive: false },
        }),
      ),
    ).toBe('Sanne de Vries connected Claude to the site')
    expect(
      activityText(
        row({
          action: 'mcp_connection.revoke',
          targetType: 'mcp_connection',
          meta: { clientName: 'ChatGPT', allowGoLive: true },
        }),
      ),
    ).toBe('Sanne de Vries disconnected ChatGPT from the site')
    expect(
      activityText(
        row({
          action: 'mcp_connection.revoke',
          targetType: 'mcp_connection',
          meta: null,
        }),
      ),
    ).toBe('Sanne de Vries disconnected an AI app from the site')
  })

  it('reads the via-AI key name only for MCP-performed rows', () => {
    expect(
      viaMcpKey(row({ meta: { via: 'mcp', mcpKeyName: 'Claude' } })),
    ).toEqual({ name: 'Claude', agency: false })
    expect(viaMcpKey(row({ meta: { via: 'ui' } }))).toBeNull()
    expect(viaMcpKey(row({ meta: null }))).toBeNull()
  })

  it('marks rows made through the agency connector', () => {
    expect(
      viaMcpKey(
        row({ meta: { via: 'mcp-agency', mcpKeyName: 'Areca agency' } }),
      ),
    ).toEqual({ name: 'Areca agency', agency: true })
  })
})

describe('asset uploads in the activity log', () => {
  it.each([
    ['asset.update', 'Sanne de Vries updated alt text for “spring-hero.jpg”'],
    [
      'asset.delete',
      'Sanne de Vries deleted “spring-hero.jpg” from the Library',
    ],
  ])('describes %s with the file name', (action, expected) => {
    expect(
      activityText(
        row({
          action,
          targetType: 'asset',
          meta: { filename: 'spring-hero.jpg' },
        }),
      ),
    ).toBe(expected)
  })

  it('names the file uploaded to the Library', () => {
    expect(
      activityText(
        row({
          action: 'asset.upload',
          targetType: 'asset',
          targetId: 'a1',
          meta: {
            filename: 'spring-hero.jpg',
            via: 'mcp',
            mcpKeyName: 'Laptop',
          },
        }),
      ),
    ).toBe('Sanne de Vries uploaded “spring-hero.jpg” to the Library')
    expect(
      activityText(
        row({
          action: 'asset.upload',
          targetType: 'asset',
          targetId: 'a2',
          meta: { originalFilename: 'brochure.pdf' },
        }),
      ),
    ).toBe('Sanne de Vries uploaded “brochure.pdf” to the Library')
  })

  it('falls back to a generic word when the filename is missing', () => {
    expect(
      activityText(
        row({ action: 'asset.upload', targetType: 'asset', targetId: 'a3' }),
      ),
    ).toBe('Sanne de Vries uploaded a file to the Library')
  })
})

describe('site content (globals) in the activity log', () => {
  // Section upserts, toggles and deletes target the section's collection row
  // (targetType 'collection', meta.key/label); discards target the entry.
  it('tells a section being saved, switched on/off and deleted', () => {
    const section = { targetType: 'collection', targetId: 'c1' } as const
    const saved = activityText(
      row({
        ...section,
        action: 'global.upsert',
        meta: { key: 'companyInfo', label: 'Company info', kind: 'global' },
      }),
    )
    const toggled = activityText(
      row({
        ...section,
        action: 'global.set_enabled',
        meta: { key: 'companyInfo', enabled: false },
      }),
      null,
    )
    const deleted = activityText(
      row({
        ...section,
        action: 'global.delete',
        meta: { key: 'companyInfo', label: 'Company info', kind: 'global' },
      }),
    )
    for (const text of [saved, toggled, deleted]) {
      expect(text).toContain('Sanne de Vries')
      expect(text).not.toMatch(/global[ ._](upsert|set_enabled|delete)/)
    }
    expect(saved).toContain('Company info')
    expect(deleted).toContain('Company info')
  })

  it('tells a discarded draft of a section', () => {
    const text = activityText(
      row({
        action: 'entry.discard',
        targetType: 'entry',
        targetId: 'e1',
        meta: { key: 'companyInfo' },
      }),
      'Company info',
    )
    expect(text).toContain('Sanne de Vries')
    expect(text).toContain('Company info')
    expect(text).toMatch(/discard/i)
    expect(text).not.toMatch(/entry[ ._]discard/)
  })
})

describe('activityText for development environments', () => {
  it('says what happened to the dev env, without an entry title', () => {
    expect(
      activityText(
        row({
          action: 'dev_env.fork',
          targetType: 'site',
          meta: { slug: 'acme-dev', collections: 2, sections: 1, entries: 9 },
        }),
      ),
    ).toBe('Sanne de Vries created a development environment')
    expect(
      activityText(
        row({
          action: 'dev_env.refresh',
          targetType: 'site',
          meta: { slug: 'acme-dev', discardedEntries: 3 },
        }),
      ),
    ).toBe('Sanne de Vries reset the development environment from production')
    expect(
      activityText(
        row({ action: 'dev_env.delete', targetType: 'site', meta: {} }),
      ),
    ).toBe('Sanne de Vries deleted the development environment')
  })

  it('says a dev env was renamed, with its new slug', () => {
    expect(
      activityText(
        row({
          action: 'dev_env.rename',
          targetType: 'site',
          meta: { previousSlug: 'acme-dev', slug: 'acme-2-dev' },
        }),
      ),
    ).toBe('Sanne de Vries renamed the development environment to acme-2-dev')
  })

  it('counts the changes a push wrote, in the right plural', () => {
    expect(
      activityText(
        row({
          action: 'dev_env.push',
          targetType: 'site',
          meta: { schema: 1, new: 2, changed: 4, archived: 1, skipped: 2 },
        }),
      ),
    ).toBe('Sanne de Vries pushed 8 changes to production')
    expect(
      activityText(
        row({
          action: 'dev_env.push',
          targetType: 'site',
          meta: { new: 1, changed: 0, skipped: 0 },
        }),
      ),
    ).toBe('Sanne de Vries pushed 1 change to production')
  })

  it('names the entry a copy to production was made from', () => {
    expect(
      activityText(
        row({
          action: 'dev_env.copy_entry',
          targetType: 'entry',
          targetId: 'e9',
          meta: {},
        }),
        'Spring menu',
      ),
    ).toBe('Sanne de Vries copied “Spring menu” to production as a draft')
  })
})
