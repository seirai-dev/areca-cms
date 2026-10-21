import type {
  EventKey,
  MatrixCell,
  MyNotifications,
  NotificationRole,
  PreferenceRow,
  RulesMatrix,
} from '#/lib/notifications'

/** One saved change to a rule cell, for the roles `TRole`. */
export type RuleChangeFor<TRole extends NotificationRole> =
  | { event: EventKey; role: TRole; enabled: boolean; locked: boolean }
  | { event: EventKey; role: TRole; clear: true }

export type RuleChange = RuleChangeFor<NotificationRole>

/** Organization rules only take owner and editor cells. */
export type OrgRuleChange = RuleChangeFor<'owner' | 'editor'>

/** Account → Notifications: one switch flipped for one event. */
export type PreferenceChange = {
  /** null is the agency alerts group. */
  organizationId: string | null
  event: EventKey
  enabled: boolean
}

export function findCell(
  matrix: RulesMatrix | undefined,
  event: EventKey,
  role: NotificationRole,
): MatrixCell | undefined {
  return matrix?.rows.find((row) => row.event === event)?.cells[role]
}

/**
 * The cell as it will read once the server confirms the change. A lock always
 * means on, so locking forces enabled; clearing keeps the shown value until
 * the server returns the inherited one.
 */
function nextCell(cell: MatrixCell, change: RuleChange): MatrixCell {
  if ('clear' in change) return { ...cell, overridden: false }
  return {
    ...cell,
    enabled: change.locked ? true : change.enabled,
    locked: change.locked,
    overridden: true,
  }
}

/** Optimistic update of one cell. Other cells are returned unchanged. */
export function applyRuleChange<T extends RulesMatrix>(
  matrix: T,
  change: RuleChange,
): T {
  return {
    ...matrix,
    rows: matrix.rows.map((row) => {
      const cell = row.cells[change.role]
      if (row.event !== change.event || !cell) return row
      return {
        ...row,
        cells: { ...row.cells, [change.role]: nextCell(cell, change) },
      }
    }),
  }
}

/** Agency defaults hold two matrices: clients (owner, editor) and agency. */
export function applyAgencyRuleChange(
  data: { clients: RulesMatrix; agency: RulesMatrix },
  change: RuleChange,
) {
  if (change.role === 'agency') {
    return { ...data, agency: applyRuleChange(data.agency, change) }
  }
  return { ...data, clients: applyRuleChange(data.clients, change) }
}

/**
 * The change a switch press sends. A locked cell has its switch disabled, so
 * this is only reached for unlocked cells; the lock is kept as it is.
 */
export function switchChange(
  cell: MatrixCell,
  enabled: boolean,
): { enabled: boolean; locked: boolean } {
  return { enabled, locked: cell.locked }
}

/**
 * The change a lock press sends. Locking turns the email on; unlocking leaves
 * it on or off as it was.
 */
export function lockChange(cell: MatrixCell): {
  enabled: boolean
  locked: boolean
} {
  return cell.locked
    ? { enabled: cell.enabled, locked: false }
    : { enabled: true, locked: true }
}

/** Account rows: flip one event's switch in the optimistic copy. */
export function applyPreferenceChange(
  data: MyNotifications,
  change: PreferenceChange,
): MyNotifications {
  const flip = (rows: PreferenceRow[]) =>
    rows.map((row) =>
      row.event === change.event && row.lockedBy === null
        ? { ...row, enabled: change.enabled }
        : row,
    )
  if (change.organizationId === null) {
    return data.agency
      ? { ...data, agency: { events: flip(data.agency.events) } }
      : data
  }
  return {
    ...data,
    orgs: data.orgs.map((org) =>
      org.organizationId === change.organizationId
        ? { ...org, events: flip(org.events) }
        : org,
    ),
  }
}
