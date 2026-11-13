import { describe, expect, it } from 'vitest'
import type { QueryKey } from '@tanstack/react-query'

import { OVERVIEW_ENTRIES, queryKeys } from './query-keys.ts'

function startsWith(key: QueryKey, prefix: QueryKey) {
  return prefix.every((part, index) => Object.is(key[index], part))
}

describe('queryKeys prefixes', () => {
  it.each<[string, QueryKey, QueryKey]>([
    ['site entries', queryKeys.entries('s', 'posts'), queryKeys.entriesOf('s')],
    [
      'collection entries',
      queryKeys.entries('s', 'posts', { status: 'draft' }),
      queryKeys.entriesOf('s', 'posts'),
    ],
    [
      'overview lists',
      queryKeys.recentEntries('s', 'recent'),
      queryKeys.entriesOf('s', OVERVIEW_ENTRIES),
    ],
    ['entry title', queryKeys.entryTitle('e'), queryKeys.entry('e')],
    ['entry', queryKeys.entry('e'), queryKeys.entryFamily()],
    [
      'section editor',
      queryKeys.global('s', 'home'),
      queryKeys.globalFamily('s'),
    ],
    [
      'library',
      queryKeys.libraryAssets('o', '', undefined),
      queryKeys.assetsOf('o'),
    ],
    [
      'media picker',
      queryKeys.pickerAssets('o', '', true),
      queryKeys.assetsOf('o'),
    ],
    ['recent mail', queryKeys.mailRecent(true), queryKeys.mailRecent()],
    ['invitations', queryKeys.invitations('o'), queryKeys.allInvitations()],
    [
      'field usage',
      queryKeys.fieldDataUsage('s', 'posts'),
      queryKeys.fieldDataUsage('s'),
    ],
    [
      'dokploy applications',
      queryKeys.dokployApplications('o'),
      queryKeys.dokployCredentials('o'),
    ],
    [
      'cloudflare targets',
      queryKeys.cloudflareDeployTargets('o'),
      queryKeys.cloudflareCredentials('o'),
    ],
    [
      'link search',
      queryKeys.linkSearch('s', null, 'q', 10),
      queryKeys.linkTargets('s'),
    ],
  ])('%s sits under its invalidation prefix', (_, key, prefix) => {
    expect(startsWith(key, prefix)).toBe(true)
  })

  it('keeps the keys other code invalidates by value', () => {
    expect(queryKeys.goLivePending('s')).toEqual(['golive-pending', 's'])
    expect(queryKeys.sitesOverview()).toEqual(['sites-overview'])
    expect(queryKeys.me()).toEqual(['me'])
  })
})
