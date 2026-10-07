import { describe, expect, it, vi } from 'vitest'
import { publishingRequestIdentity } from './request-identity'

function storage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value)
    },
    removeItem: (key: string) => {
      items.delete(key)
    },
  }
}

describe('publishing request identity', () => {
  it('reuses a persisted key for a lost response and rotates only after completion', () => {
    const disk = storage()
    const site = crypto.randomUUID()
    const first = publishingRequestIdentity(
      'actor',
      site,
      'publish',
      'normal',
      disk,
    )
    const retry = publishingRequestIdentity(
      'actor',
      site,
      'publish',
      'normal',
      disk,
    )
    expect(retry.key).toBe(first.key)
    expect(() =>
      publishingRequestIdentity('actor', site, 'publish', 'urgent', disk),
    ).toThrow(/unresolved/)
    retry.complete()
    expect(
      publishingRequestIdentity('actor', site, 'publish', 'urgent', disk).key,
    ).not.toBe(first.key)
  })

  it('scopes persistence to actor and operation and survives a fresh storage reader', async () => {
    const disk = storage()
    const site = crypto.randomUUID()
    const first = publishingRequestIdentity(
      'actor',
      site,
      'rollback',
      'publication',
      disk,
    )
    const reload = { ...disk }
    expect(
      publishingRequestIdentity(
        'actor',
        site,
        'rollback',
        'publication',
        reload,
      ).key,
    ).toBe(first.key)
    expect(
      publishingRequestIdentity(
        'other-actor',
        site,
        'rollback',
        'publication',
        disk,
      ).key,
    ).not.toBe(first.key)
    expect(
      publishingRequestIdentity('actor', site, 'publish', 'publication', disk)
        .key,
    ).not.toBe(first.key)
  })

  it('restores a key after a full module reload', async () => {
    const disk = storage()
    const site = crypto.randomUUID()
    const first = publishingRequestIdentity(
      'actor',
      site,
      'publish',
      'normal',
      disk,
    )
    vi.resetModules()
    const reloaded = await import('./request-identity')
    expect(
      reloaded.publishingRequestIdentity(
        'actor',
        site,
        'publish',
        'normal',
        disk,
      ).key,
    ).toBe(first.key)
  })

  it('rejects malformed or incomplete persistent identities before dispatch', () => {
    for (const data of [
      '{broken',
      '{}',
      '{"key":"not-a-uuid","payload":"normal"}',
    ]) {
      const disk = storage()
      disk.getItem = () => data
      expect(() =>
        publishingRequestIdentity(
          'actor',
          crypto.randomUUID(),
          'publish',
          'normal',
          disk,
        ),
      ).toThrow()
    }
  })

  it('keeps a known successful response successful when storage cleanup fails', () => {
    const disk = storage()
    const site = crypto.randomUUID()
    const first = publishingRequestIdentity(
      'actor',
      site,
      'publish',
      'normal',
      disk,
    )
    disk.removeItem = () => {
      throw new Error('Storage unavailable')
    }
    expect(() => first.complete()).not.toThrow()
    expect(
      publishingRequestIdentity('actor', site, 'publish', 'normal', disk).key,
    ).not.toBe(first.key)
  })

  it('allows changed payload after a confirmed validation rejection', () => {
    const disk = storage()
    const site = crypto.randomUUID()
    const rejected = publishingRequestIdentity(
      'actor',
      site,
      'rollback',
      'invalid-publication',
      disk,
    )
    rejected.complete()
    expect(
      publishingRequestIdentity(
        'actor',
        site,
        'rollback',
        'valid-publication',
        disk,
      ).key,
    ).not.toBe(rejected.key)
  })

  it('fails before dispatch if durable browser storage cannot be written', () => {
    const disk = storage()
    disk.setItem = () => {
      throw new Error('Storage unavailable')
    }
    expect(() =>
      publishingRequestIdentity(
        'actor',
        crypto.randomUUID(),
        'publish',
        'normal',
        disk,
      ),
    ).toThrow('Storage unavailable')
  })
})
