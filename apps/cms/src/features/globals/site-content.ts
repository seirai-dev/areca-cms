/**
 * Pure helpers for site content (globals) in the UI: the sidebar group and
 * the section editor's field runs. Route paths are typed literals so Link
 * callers pass `params: { siteId, globalKey }`.
 */

import { GLOBAL_ROUTE } from '#/lib/content-route'

export { GLOBAL_ROUTE }

export type SiteContentNavItem = {
  key: string
  label: string
  enabled: boolean
  to: typeof GLOBAL_ROUTE
}

/**
 * Sections for the "Site content" sidebar group. Editors see enabled sections
 * only (no group at all when there are none); the agency sees every section,
 * disabled ones flagged so they can be dimmed.
 */
export function siteContentNavItems(
  globals: ReadonlyArray<{ key: string; label: string; enabled: boolean }>,
  { isAgencyAdmin }: { isAgencyAdmin: boolean },
): SiteContentNavItem[] {
  return globals
    .filter((global) => isAgencyAdmin || global.enabled)
    .map((global) => ({
      key: global.key,
      label: global.label,
      enabled: global.enabled,
      to: GLOBAL_ROUTE,
    }))
}

/**
 * Consecutive fields with the same group heading form one run. Ungrouped
 * fields are runs with `group: null`. A heading that reappears after another
 * starts a new run, so the editor renders it again.
 */
export function groupFields<T extends { group?: string }>(
  fields: ReadonlyArray<T>,
): { group: string | null; fields: T[] }[] {
  const runs: { group: string | null; fields: T[] }[] = []
  for (const field of fields) {
    const group = field.group || null
    const last = runs.at(-1)
    if (last && last.group === group) {
      last.fields.push(field)
    } else {
      runs.push({ group, fields: [field] })
    }
  }
  return runs
}
