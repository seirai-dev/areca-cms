import { AsyncLocalStorage } from 'node:async_hooks'

import type { AuditMeta } from '#/lib/types'

const storage = new AsyncLocalStorage<AuditMeta>()

/**
 * Run `fn` so that every `audit()` row written inside it carries `meta`.
 * Used by the MCP server to label actions as "via AI (key name)". Explicit
 * `meta` passed to `audit()` wins over the context on key collisions.
 */
export function withAuditContext<T>(
  meta: AuditMeta,
  fn: () => Promise<T>,
): Promise<T> {
  const parent = storage.getStore()
  return storage.run({ ...parent, ...meta }, fn)
}

export function currentAuditContext(): AuditMeta | undefined {
  return storage.getStore()
}
