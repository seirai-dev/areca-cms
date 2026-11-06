import { describe, expect, it } from 'vitest'

import { referenceKey, referenceWarnings, referenceWarningList } from './write'

describe('dev environment warnings for cleared links', () => {
  it('reports a cleared entry link as link-cleared, not as a reference', () => {
    const warnings = referenceWarningList(
      [{ field: 'body', locale: 'nl', devTargetId: 'dev-1', kind: 'link' }],
      new Set(),
    )
    expect(warnings).toEqual([
      {
        code: 'link-cleared',
        params: { field: 'body', locale: 'nl', devTargetId: 'dev-1' },
        message: expect.stringContaining('Link cleared'),
      },
    ])
  })

  it('keeps a reference and a link to the same target apart, and shows each once', () => {
    const cleared = [
      { field: 'body', devTargetId: 'dev-1', kind: 'link' as const },
      { field: 'body', devTargetId: 'dev-1', kind: 'link' as const },
      { field: 'related', devTargetId: 'dev-1' },
    ]
    const seen = new Set<string>()
    const warnings = referenceWarnings('item-1', cleared, seen)
    expect(warnings.map((warning) => warning.code)).toEqual([
      'link-cleared',
      'reference-cleared',
    ])
    expect(warnings.every((warning) => warning.itemId === 'item-1')).toBe(true)
    expect(referenceKey(cleared[0])).not.toBe(referenceKey(cleared[2]))
  })
})
