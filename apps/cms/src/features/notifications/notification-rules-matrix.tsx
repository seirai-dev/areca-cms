import { LockSimple, LockSimpleOpen } from '@phosphor-icons/react'

import { Hint } from '#/components/ui/tooltip'
import { Switch } from '#/components/ui/switch'
import type {
  EventKey,
  MatrixCell,
  NotificationRole,
  RulesMatrix,
} from '#/lib/notifications'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { eventDescription, eventLabel, roleLabel } from './notification-copy'
import { lockChange, switchChange } from './notification-rules-logic'
import type { RuleChangeFor } from './notification-rules-logic'

/**
 * Columns from 640px: the event, then one column per role. Phones stack each
 * event's roles under it. Literal class names so Tailwind keeps them.
 */
const COLUMNS: Record<number, string> = {
  1: 'min-[640px]:grid-cols-[minmax(0,1fr)_minmax(0,176px)]',
  2: 'min-[640px]:grid-cols-[minmax(0,1fr)_minmax(0,176px)_minmax(0,176px)]',
  3: 'min-[640px]:grid-cols-[minmax(0,1fr)_minmax(0,176px)_minmax(0,176px)_minmax(0,176px)]',
}

/**
 * Events × roles. Each cell is a switch with a lock beside it: a locked cell
 * is on and its switch is disabled (unlock first to turn it off). Cells the
 * agency locked above are read-only with "Required by {agency}".
 */
export function NotificationRulesMatrix<TRole extends NotificationRole>({
  matrix,
  roles,
  agencyName = '',
  onChange,
}: {
  matrix: RulesMatrix
  roles: TRole[]
  /** Named in "Required by …" for cells locked above. */
  agencyName?: string
  onChange: (change: RuleChangeFor<TRole>) => void
}) {
  const columns = COLUMNS[roles.length] ?? COLUMNS[3]

  return (
    <div className="grid" data-testid="rules-matrix">
      <div
        aria-hidden="true"
        className={cn(
          'hidden gap-4 border-b border-border-default pb-3 text-caption font-medium text-text-muted min-[640px]:grid',
          columns,
        )}
      >
        <span>{m.notifications_matrix_email()}</span>
        {roles.map((role) => (
          <span key={role} className="text-center">
            {roleLabel(role)}
          </span>
        ))}
      </div>

      <ul className="grid divide-y divide-border-default">
        {matrix.rows.map((row) => (
          <li
            key={row.event}
            data-testid={`rule-row-${row.event}`}
            className={cn(
              'grid gap-3 py-4 first:pt-0 last:pb-0 min-[640px]:items-center min-[640px]:gap-4 min-[640px]:first:pt-4',
              columns,
            )}
          >
            <div className="grid min-w-0 gap-0.5">
              <p className="text-[14px] leading-5 font-medium text-text-primary">
                {eventLabel(row.event)}
              </p>
              <p className="text-callout text-text-secondary">
                {eventDescription(row.event)}
              </p>
            </div>
            {roles.map((role) => {
              const cell = row.cells[role]
              if (!cell) {
                return (
                  <span
                    key={role}
                    aria-hidden="true"
                    className="hidden min-[640px]:block"
                  />
                )
              }
              return (
                <RuleCell
                  key={role}
                  event={row.event}
                  role={role}
                  cell={cell}
                  agencyName={agencyName}
                  onChange={onChange}
                />
              )
            })}
          </li>
        ))}
      </ul>
    </div>
  )
}

function RuleCell<TRole extends NotificationRole>({
  event,
  role,
  cell,
  agencyName,
  onChange,
}: {
  event: EventKey
  role: TRole
  cell: MatrixCell
  agencyName: string
  onChange: (change: RuleChangeFor<TRole>) => void
}) {
  const label = eventLabel(event)
  const name = roleLabel(role)
  const testId = `rule-${event}-${role}`

  return (
    <div className="flex items-center justify-between gap-3 min-[640px]:justify-center">
      <span className="text-callout text-text-secondary min-[640px]:hidden">
        {name}
      </span>
      <div className="flex flex-col items-end gap-1 min-[640px]:items-center">
        <div className="flex items-center gap-2">
          <Hint label={m.notifications_lock_tooltip()}>
            <button
              type="button"
              aria-pressed={cell.locked}
              aria-label={m.notifications_lock_aria({
                event: label,
                role: name,
              })}
              data-testid={`${testId}-lock`}
              disabled={cell.lockedAbove}
              onClick={() => onChange({ event, role, ...lockChange(cell) })}
              className={cn(
                'grid size-8 place-content-center rounded-control text-icon-muted transition-colors',
                'outline-none hover:bg-surface-state-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                'disabled:cursor-not-allowed disabled:opacity-40',
                cell.locked && 'text-icon-accent',
              )}
            >
              {cell.locked ? (
                <LockSimple weight="fill" className="size-4" />
              ) : (
                <LockSimpleOpen className="size-4" />
              )}
            </button>
          </Hint>
          <Switch
            aria-label={m.notifications_switch_aria({
              event: label,
              role: name,
            })}
            data-testid={`${testId}-switch`}
            checked={cell.enabled}
            disabled={cell.locked || cell.lockedAbove}
            onCheckedChange={(enabled) =>
              onChange({ event, role, ...switchChange(cell, enabled) })
            }
          />
        </div>
        {cell.lockedAbove ? (
          <span className="text-caption font-normal text-text-muted">
            {m.notifications_required_by({ name: agencyName })}
          </span>
        ) : cell.overridden ? (
          <button
            type="button"
            data-testid={`${testId}-reset`}
            aria-label={m.notifications_reset_aria({
              event: label,
              role: name,
            })}
            onClick={() => onChange({ event, role, clear: true })}
            className="rounded-[6px] text-caption font-medium text-text-link outline-none hover:underline focus-visible:outline-2 focus-visible:outline-border-focus"
          >
            {m.notifications_reset()}
          </button>
        ) : null}
      </div>
    </div>
  )
}
