import type { MembershipRole } from '#/lib/types'

/**
 * The person page's client access is staged: picks, role changes and removals
 * stay on the screen until one Save sends them all. This module holds the
 * rows and turns them into the payload `setUserClientAccessFn` takes.
 */

export type StagedAccessRow = {
  organizationId: string
  name: string
  slug: string
  /** The role saved on the server. `null` for a client picked in this session. */
  savedRole: MembershipRole | null
  /** The role the row shows (and will be saved with). */
  role: MembershipRole
  /** The person is the only owner: demoting or removing them will be refused. */
  isOnlyOwner: boolean
  /** Removed in this session. Saved rows stay struck through until Save. */
  removed: boolean
}

export type AccessGrant = { organizationId: string; role: MembershipRole }

export type AccessChange = {
  add: AccessGrant[]
  change: AccessGrant[]
  remove: string[]
}

export type AccessSummary = { added: number; changed: number; removed: number }

export type ClientPick = { organizationId: string; name: string; slug: string }

/** Saved memberships → rows, sorted by client name. */
export function stageFromMemberships(
  memberships: Array<{
    organizationId: string
    organizationName: string
    organizationSlug: string
    role: MembershipRole
    isOnlyOwner: boolean
  }>,
): StagedAccessRow[] {
  return memberships
    .map((item) => ({
      organizationId: item.organizationId,
      name: item.organizationName,
      slug: item.organizationSlug,
      savedRole: item.role,
      role: item.role,
      isOnlyOwner: item.isOnlyOwner,
      removed: false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Adds picked clients as new rows with one role each. A client already in
 * the list is left alone; a saved client removed in this session comes back
 * with its saved role.
 */
export function addPicks(
  rows: StagedAccessRow[],
  picks: ClientPick[],
  role: MembershipRole,
): StagedAccessRow[] {
  const next = [...rows]
  for (const pick of picks) {
    const index = next.findIndex(
      (row) => row.organizationId === pick.organizationId,
    )
    if (index === -1) {
      next.push({
        organizationId: pick.organizationId,
        name: pick.name,
        slug: pick.slug,
        savedRole: null,
        role,
        isOnlyOwner: false,
        removed: false,
      })
    } else if (next[index].removed) {
      next[index] = { ...next[index], removed: false }
    }
  }
  return next.sort((a, b) => a.name.localeCompare(b.name))
}

export function setRole(
  rows: StagedAccessRow[],
  organizationId: string,
  role: MembershipRole,
): StagedAccessRow[] {
  return rows.map((row) =>
    row.organizationId === organizationId ? { ...row, role } : row,
  )
}

/** A client picked in this session disappears; a saved one is struck through. */
export function removeRow(
  rows: StagedAccessRow[],
  organizationId: string,
): StagedAccessRow[] {
  return rows.flatMap((row) => {
    if (row.organizationId !== organizationId) return [row]
    return row.savedRole === null ? [] : [{ ...row, removed: true }]
  })
}

export function undoRemove(
  rows: StagedAccessRow[],
  organizationId: string,
): StagedAccessRow[] {
  return rows.map((row) =>
    row.organizationId === organizationId ? { ...row, removed: false } : row,
  )
}

/** The save payload: only what differs from what the server has. */
export function accessChange(rows: StagedAccessRow[]): AccessChange {
  const change: AccessChange = { add: [], change: [], remove: [] }
  for (const row of rows) {
    if (row.savedRole === null) {
      if (!row.removed) {
        change.add.push({ organizationId: row.organizationId, role: row.role })
      }
      continue
    }
    if (row.removed) {
      change.remove.push(row.organizationId)
    } else if (row.role !== row.savedRole) {
      change.change.push({ organizationId: row.organizationId, role: row.role })
    }
  }
  return change
}

export function accessSummary(change: AccessChange): AccessSummary {
  return {
    added: change.add.length,
    changed: change.change.length,
    removed: change.remove.length,
  }
}

export function hasStagedChanges(change: AccessChange) {
  return change.add.length + change.change.length + change.remove.length > 0
}

/** Rows whose role was changed in this session (for the iris dot). */
export function isRoleChanged(row: StagedAccessRow) {
  return row.savedRole !== null && row.savedRole !== row.role && !row.removed
}

/**
 * The server names the client in its refusal ("Cannot demote the last owner
 * of Acme…"). Finds that row so the error can sit on it.
 */
export function rowForServerError(
  rows: StagedAccessRow[],
  message: string,
): string | null {
  const match = rows.find((row) => message.includes(row.name))
  return match ? match.organizationId : null
}
