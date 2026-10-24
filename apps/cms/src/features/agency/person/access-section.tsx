import * as React from 'react'
import { Link, useBlocker } from '@tanstack/react-router'
import { CaretRight, Plus, X } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { FloatingBar, FloatingBarLabel } from '#/components/ui/floating-bar'
import { Hint } from '#/components/ui/tooltip'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { SettingsSection } from '#/components/ui/settings-section'
import { SlideOver } from '#/components/ui/slide-over'
import { Tag } from '#/components/ui/tag'
import { ClientTile } from '#/features/agency/client-tile'
import { ClientPicker } from '#/features/agency/client-picker'
import { usePeopleMutations } from '#/features/agency/use-people-mutations'
import type { ClientRow, PersonDetail } from '#/features/agency/queries'
import { errorMessage, membershipRoleLabel } from '#/lib/admin/helpers'
import type { MembershipRole } from '#/lib/types'
import { useMediaQuery } from '#/hooks/use-mobile'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import {
  accessChange,
  accessSummary,
  addPicks,
  hasStagedChanges,
  isRoleChanged,
  removeRow,
  rowForServerError,
  setRole as setRowRole,
  stageFromMemberships,
  undoRemove,
} from './access-stage'
import type { ClientPick, StagedAccessRow } from './access-stage'

/**
 * The person's clients (brief §3.9, adapted): one table of access rows that
 * stages every change. Picks, role changes and removals wait on the screen
 * until Save sends them in one request. Leaving with changes asks first.
 */
export function AccessSection({
  detail,
  clients,
}: {
  detail: PersonDetail
  clients: ClientRow[]
}) {
  const mutations = usePeopleMutations()
  const phone = useMediaQuery('(max-width: 639px)')
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  /** The last save was refused: the summary says so until the next edit. */
  const [refused, setRefused] = React.useState(false)
  const [sheetFor, setSheetFor] = React.useState<string | null>(null)

  // Reset the staged rows only when the saved access itself changes (after a
  // save, or another admin's edit), so a refetch never drops a draft.
  const baselineKey = detail.memberships
    .map((item) => `${item.organizationId}:${item.role}:${item.isOnlyOwner}`)
    .join('|')
  const [staged, setStaged] = React.useState<StagedAccessRow[]>(() =>
    stageFromMemberships(detail.memberships),
  )
  const [baseline, setBaseline] = React.useState(baselineKey)
  if (baseline !== baselineKey) {
    setBaseline(baselineKey)
    setStaged(stageFromMemberships(detail.memberships))
    setErrors({})
  }

  const change = React.useMemo(() => accessChange(staged), [staged])
  const summary = accessSummary(change)
  const dirty = hasStagedChanges(change)

  const dirtyRef = React.useRef(dirty)
  React.useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])
  const blocker = useBlocker({
    shouldBlockFn: () => dirtyRef.current,
    enableBeforeUnload: () => dirtyRef.current,
    withResolver: true,
  })

  const existing = React.useMemo(
    () =>
      new Map<string, MembershipRole>(
        staged
          .filter((row) => !row.removed)
          .map((row) => [row.organizationId, row.role]),
      ),
    [staged],
  )
  const newPicks = React.useMemo(
    () =>
      new Set(
        staged
          .filter((row) => row.savedRole === null && !row.removed)
          .map((row) => row.organizationId),
      ),
    [staged],
  )

  function update(next: StagedAccessRow[]) {
    setStaged(next)
    setErrors({})
    setRefused(false)
  }

  function pick(picks: ClientPick[], role: MembershipRole) {
    update(addPicks(staged, picks, role))
  }

  function discard() {
    update(stageFromMemberships(detail.memberships))
  }

  async function save() {
    setErrors({})
    setRefused(false)
    try {
      await mutations.saveAccess.mutateAsync({ userId: detail.id, ...change })
      toast.success(m.agency_person_saved())
    } catch (error) {
      const message = errorMessage(error)
      const organizationId = rowForServerError(staged, message)
      setRefused(true)
      if (organizationId) setErrors({ [organizationId]: message })
      else toast.error(message)
    }
  }

  // Name the blocker, not the whole save: a refused row that drops the only owner
  // is "needs an owner"; any other refusal sends the user to the red lines.
  const refusedRows = staged.filter((row) => errors[row.organizationId])
  const ownerRows = refusedRows.filter(
    (row) => row.isOnlyOwner && (row.removed || row.role !== 'owner'),
  )
  const refusedText =
    refusedRows.length > 0 && ownerRows.length === refusedRows.length
      ? ownerRows.length === 1
        ? m.agency_person_save_refused_owner({ client: ownerRows[0].name })
        : m.agency_person_save_refused_owners({ count: ownerRows.length })
      : refusedRows.length > 0
        ? m.agency_person_save_refused_marked()
        : m.agency_person_save_refused_one()

  const sheetRow = staged.find((row) => row.organizationId === sheetFor)
  const summaryText = [
    summary.added > 0
      ? summary.added === 1
        ? m.agency_person_summary_added_one()
        : m.agency_person_summary_added({ count: summary.added })
      : null,
    summary.changed > 0
      ? summary.changed === 1
        ? m.agency_person_summary_changed_one()
        : m.agency_person_summary_changed({ count: summary.changed })
      : null,
    summary.removed > 0
      ? summary.removed === 1
        ? m.agency_person_summary_removed_one()
        : m.agency_person_summary_removed({ count: summary.removed })
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <SettingsSection
        id="person-clients"
        title={m.agency_person_clients_title()}
        description={m.agency_person_clients_description()}
        bare
      >
        <div
          className="overflow-hidden surface-card"
          data-dirty={dirty ? 'true' : undefined}
          data-testid="person-access"
        >
          {staged.length === 0 ? (
            <p className="px-4 py-8 text-center text-callout text-text-muted">
              {m.agency_person_no_clients()}
            </p>
          ) : (
            <ul>
              {!phone ? (
                <li
                  aria-hidden="true"
                  className="grid grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-3 px-4 pt-3 pb-2 text-overline text-text-muted"
                >
                  <span>{m.agency_person_col_client()}</span>
                  <span>{m.agency_person_col_role()}</span>
                  <span className="sr-only">
                    {m.agency_person_col_remove()}
                  </span>
                </li>
              ) : null}
              {staged.map((row) =>
                phone ? (
                  <AccessRowPhone
                    key={row.organizationId}
                    row={row}
                    error={errors[row.organizationId]}
                    onOpen={() => setSheetFor(row.organizationId)}
                  />
                ) : (
                  <AccessRowDesktop
                    key={row.organizationId}
                    row={row}
                    error={errors[row.organizationId]}
                    onRole={(role) =>
                      update(setRowRole(staged, row.organizationId, role))
                    }
                    onRemove={() =>
                      update(removeRow(staged, row.organizationId))
                    }
                    onUndo={() =>
                      update(undoRemove(staged, row.organizationId))
                    }
                  />
                ),
              )}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-default px-4 py-3">
            <ClientPicker
              clients={clients}
              existing={existing}
              staged={newPicks}
              onAdd={pick}
              align="start"
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="person-add-clients"
              >
                <Plus />
                {m.agency_person_add_clients()}
              </Button>
            </ClientPicker>
            <p className="text-caption font-normal text-text-muted">
              {m.agency_person_add_clients_hint()}
            </p>
          </div>
        </div>
      </SettingsSection>

      <SlideOver
        open={sheetFor !== null && sheetRow !== undefined}
        onOpenChange={(open) => {
          if (!open) setSheetFor(null)
        }}
        fit
        title={sheetRow?.name ?? ''}
        description={m.agency_person_sheet_description()}
        data-testid="person-client-sheet"
      >
        {sheetRow ? (
          <div className="grid gap-4 pt-1">
            {sheetRow.removed ? (
              <p className="text-callout text-text-secondary">
                {m.agency_person_removed_hint()}
              </p>
            ) : (
              <SegmentedControl
                fullWidth
                aria-label={m.agency_person_role_for({ client: sheetRow.name })}
                value={sheetRow.role}
                onValueChange={(role) =>
                  update(setRowRole(staged, sheetRow.organizationId, role))
                }
                data-testid="person-client-sheet-role"
                options={[
                  { value: 'editor', label: m.admin_role_editor() },
                  { value: 'owner', label: m.admin_role_owner() },
                ]}
              />
            )}
            {sheetRow.isOnlyOwner && sheetRow.role === 'owner' ? (
              <p className="text-caption font-normal text-text-muted">
                {m.agency_person_only_owner_hint({ client: sheetRow.name })}
              </p>
            ) : null}
            {errors[sheetRow.organizationId] ? (
              <p className="text-callout text-text-error">
                {errors[sheetRow.organizationId]}
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className={cn('w-full', !sheetRow.removed && 'text-text-error')}
              onClick={() => {
                update(
                  sheetRow.removed
                    ? undoRemove(staged, sheetRow.organizationId)
                    : removeRow(staged, sheetRow.organizationId),
                )
                setSheetFor(null)
              }}
              data-testid="person-client-sheet-remove"
            >
              {sheetRow.removed
                ? m.agency_person_undo()
                : m.agency_person_remove_from({ client: sheetRow.name })}
            </Button>
          </div>
        ) : null}
      </SlideOver>

      <FloatingBar
        open={dirty}
        fullWidthOnMobile
        label={m.agency_person_unsaved()}
        data-testid="person-save-bar"
      >
        <FloatingBarLabel
          data-testid="person-save-summary"
          className={cn(
            'min-w-0 flex-1',
            // On phones the summary may take two lines, so a refusal's reason reads in full.
            'max-sm:line-clamp-2 max-sm:whitespace-normal',
            refused && 'text-text-error',
          )}
        >
          {refused ? refusedText : summaryText || m.agency_person_unsaved()}
        </FloatingBarLabel>
        <Button
          type="button"
          size="sm"
          variant="quiet"
          onClick={discard}
          disabled={mutations.saveAccess.isPending}
          data-testid="person-discard"
        >
          {m.agency_person_discard()}
        </Button>
        <Button
          type="button"
          size="sm"
          loading={mutations.saveAccess.isPending}
          onClick={() => void save()}
          data-testid="person-save"
        >
          {/* "Save" on phones, "Save changes" where there is room for it. */}
          <span className="sm:hidden">{m.settings_save()}</span>
          <span className="hidden sm:inline">{m.agency_person_save()}</span>
        </Button>
      </FloatingBar>

      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.status === 'blocked') blocker.reset()
        }}
        title={m.agency_person_leave_title()}
        description={m.agency_person_leave_description()}
        confirmLabel={m.agency_person_leave_confirm()}
        cancelLabel={m.agency_person_leave_stay()}
        variant="destructive"
        onConfirm={() => {
          if (blocker.status === 'blocked') blocker.proceed()
        }}
        testId="person-leave-dialog"
      />
    </>
  )
}

function StateCaption({ row }: { row: StagedAccessRow }) {
  if (row.removed) return null
  if (row.savedRole === null) return null
  if (row.isOnlyOwner && row.role === 'owner') {
    return (
      <span className="text-caption font-normal text-text-muted">
        {m.agency_person_only_owner()}
      </span>
    )
  }
  if (isRoleChanged(row)) {
    return (
      <span className="text-caption font-normal text-text-muted">
        {m.agency_person_was_role({ role: membershipRoleLabel(row.savedRole) })}
      </span>
    )
  }
  return null
}

function AccessRowDesktop({
  row,
  error,
  onRole,
  onRemove,
  onUndo,
}: {
  row: StagedAccessRow
  error?: string
  onRole: (role: MembershipRole) => void
  onRemove: () => void
  onUndo: () => void
}) {
  const isNew = row.savedRole === null
  const changed = isRoleChanged(row)
  return (
    <li
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-3 border-t border-border-default px-4 py-3 first:border-t-0',
        isNew && 'bg-accent-soft/50',
        row.removed && 'bg-background-subtle/60',
      )}
      data-testid={`access-row-${row.slug}`}
      data-state={
        row.removed ? 'removed' : isNew ? 'new' : changed ? 'changed' : 'saved'
      }
    >
      <div className="flex min-w-0 items-center gap-3">
        <ClientTile id={row.organizationId} name={row.name} size="sm" />
        <div className="grid min-w-0 gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            {row.removed ? (
              <span className="truncate text-[14px] leading-5 font-medium text-text-muted line-through">
                {row.name}
              </span>
            ) : (
              <Link
                to="/agency/clients/$orgId"
                params={{ orgId: row.organizationId }}
                className="truncate rounded-[4px] text-[14px] leading-5 font-medium text-text-primary outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              >
                {row.name}
              </Link>
            )}
            {isNew ? <Tag tone="accent">{m.agency_person_new()}</Tag> : null}
            {row.removed ? (
              <Tag tone="neutral">{m.agency_person_removed()}</Tag>
            ) : null}
          </span>
          {row.removed ? (
            <span className="text-caption font-normal text-text-muted">
              {m.agency_person_removed_hint()}
            </span>
          ) : (
            <>
              <StateCaption row={row} />
              {!isNew &&
              !changed &&
              !(row.isOnlyOwner && row.role === 'owner') ? (
                <span className="text-caption font-normal text-text-muted">
                  {row.slug}
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        {row.removed ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onUndo}
            data-testid={`access-undo-${row.slug}`}
          >
            {m.agency_person_undo()}
          </Button>
        ) : (
          <>
            {changed ? (
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-accent"
              />
            ) : null}
            <SegmentedControl
              size="sm"
              aria-label={m.agency_person_role_for({ client: row.name })}
              value={row.role}
              onValueChange={onRole}
              data-testid={`access-role-${row.slug}`}
              options={[
                { value: 'editor', label: m.admin_role_editor() },
                { value: 'owner', label: m.admin_role_owner() },
              ]}
            />
          </>
        )}
      </div>

      <div className="flex justify-end">
        {row.removed ? null : (
          <Hint label={m.agency_person_remove_from({ client: row.name })}>
            <button
              type="button"
              aria-label={m.agency_person_remove_from({ client: row.name })}
              onClick={onRemove}
              className="relative touch-target inline-flex size-8 items-center justify-center rounded-full text-icon-muted outline-none hover:bg-surface-state-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              data-testid={`access-remove-${row.slug}`}
            >
              <X weight="bold" className="size-3.5" />
            </button>
          </Hint>
        )}
      </div>
      {error ? (
        <p
          role="alert"
          className="col-span-3 -mt-1 pb-2.5 text-caption font-normal text-text-error"
          data-testid={`access-error-${row.slug}`}
        >
          {error}
        </p>
      ) : null}
    </li>
  )
}

function AccessRowPhone({
  row,
  error,
  onOpen,
}: {
  row: StagedAccessRow
  error?: string
  onOpen: () => void
}) {
  const isNew = row.savedRole === null
  return (
    <li
      className={cn(
        'border-t border-border-default first:border-t-0',
        isNew && 'bg-accent-soft/50',
        row.removed && 'bg-background-subtle/60',
      )}
      data-testid={`access-row-${row.slug}`}
      data-state={row.removed ? 'removed' : isNew ? 'new' : 'saved'}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-surface-state-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
        aria-label={`${row.name}, ${membershipRoleLabel(row.role)}`}
        data-testid={`access-open-${row.slug}`}
      >
        <ClientTile id={row.organizationId} name={row.name} size="sm" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'truncate text-[14px] leading-5 font-medium text-text-primary',
                row.removed && 'text-text-muted line-through',
              )}
            >
              {row.name}
            </span>
            {isNew ? <Tag tone="accent">{m.agency_person_new()}</Tag> : null}
          </span>
          <StateCaption row={row} />
        </span>
        <span className="flex shrink-0 items-center gap-2 text-callout text-text-secondary">
          {row.removed ? (
            <span className="text-text-muted">{m.agency_person_removed()}</span>
          ) : (
            <>
              {isRoleChanged(row) ? (
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-accent"
                />
              ) : null}
              {membershipRoleLabel(row.role)}
            </>
          )}
          <CaretRight weight="bold" className="size-3.5 text-icon-muted" />
        </span>
      </button>
      {error ? (
        <p
          role="alert"
          className="px-4 pb-3 text-caption text-text-error"
          data-testid={`access-error-${row.slug}`}
        >
          {error}
        </p>
      ) : null}
    </li>
  )
}
