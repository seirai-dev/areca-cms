import type { Pool } from 'pg'

// Pools register themselves when their module loads, so metrics can read their
// counters without importing those modules (or creating pools of their own).
const pools = new Map<string, Pool>()

export function registerPool(label: string, pool: Pool) {
  pools.set(label, pool)
}

export type PoolStats = {
  label: string
  total: number
  idle: number
  waiting: number
  max: number
}

/** Reads pool counters only: no query, no connection. */
export function poolStats(): PoolStats[] {
  return [...pools].map(([label, pool]) => ({
    label,
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    max: pool.options.max,
  }))
}
