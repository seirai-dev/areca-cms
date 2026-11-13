import { createCn } from 'cn/engine'
import tables from './cn-tables.gen'

// Merge tables compiled from cn.config.ts; run `pnpm cn:tables` after changing it.
export const cn = createCn(tables)

/** Initials for avatars and tiles: "Kaan Kaya" → "KK". */
export function initials(name: string | null | undefined, fallback = '?') {
  if (!name) return fallback
  return (
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || fallback
  )
}
