import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  CalendarDots,
  CalendarX,
  CheckCircle,
  ClockCounterClockwise,
  Eye,
} from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { Hint } from '#/components/ui/tooltip'
import { Popover, PopoverAnchor, PopoverContent } from '#/components/ui/popover'
import { EntryPillView } from '#/features/collection/entry-pill'
import { SaveIndicator } from '#/features/editor/save-indicator'
import { ScheduleForm } from '#/features/editor/schedule-form'
import type { SaveStatus } from '#/features/editor/use-entry-editor'
import { editorPublishReason } from '#/features/golive/golive-tray'
import type { EntryUiStatus } from '#/lib/status'
import { m } from '#/paraglide/messages'

/**
 * The section editor's top bar: back to the site, the section label with its
 * status, the save indicator, then the actions (Mark as ready, Schedule, Discard
 * draft, Preview, History). Every action is gated the way entry actions are:
 * owners publish, editors save and discard, and disabled actions say why.
 */
export function GlobalEditorTopBar({
  siteId,
  label,
  uiStatus,
  backendStatus,
  scheduledAt,
  editedSinceReady,
  saveStatus,
  lastSavedAt,
  updatedAt,
  errorCount,
  onSave,
  canManage,
  busy,
  markReadyPending,
  markable,
  hasReady,
  canDiscard,
  discardPending,
  onMarkReady,
  onDiscard,
  discardReason,
  previewAvailable,
  previewUrl,
  previewReason,
  onPreview,
  scheduled,
  scheduleOpen,
  onScheduleOpenChange,
  schedulePending,
  scheduleInitialAt,
  scheduleInitialTimeZone,
  onScheduleSubmit,
  onCancelSchedule,
  onOpenHistory,
}: {
  siteId: string
  label: string
  uiStatus: EntryUiStatus
  backendStatus: string
  scheduledAt?: string | Date | null
  editedSinceReady: boolean
  saveStatus: SaveStatus
  lastSavedAt: Date | null
  updatedAt?: string | Date
  errorCount: number
  onSave: () => void
  canManage: boolean
  busy: boolean
  markReadyPending: boolean
  markable: boolean
  hasReady: boolean
  canDiscard: boolean
  discardPending: boolean
  onMarkReady: () => void
  onDiscard: () => void
  discardReason: string | null
  previewAvailable: boolean
  previewUrl?: string
  previewReason: string | null
  onPreview: () => void
  scheduled: boolean
  scheduleOpen: boolean
  onScheduleOpenChange: (open: boolean) => void
  schedulePending: boolean
  scheduleInitialAt: Date | null
  scheduleInitialTimeZone?: string | null
  onScheduleSubmit: (at: Date, timeZone: string) => void
  onCancelSchedule: () => void
  onOpenHistory: () => void
}) {
  // Ready, unchanged since: the button says so and stays disabled.
  const readyDone = hasReady && !markable && backendStatus === 'published'
  const markDisabled = !canManage || busy || readyDone

  const markReason = !canManage
    ? editorPublishReason()
    : readyDone
      ? m.editor_ready_reason()
      : null

  return (
    <header
      data-testid="global-toolbar"
      className="sticky top-0 z-navbar -mx-6 -mt-6 mb-6 border-b border-border-default bg-background-default/85 backdrop-blur-xl"
    >
      <div className="flex min-h-14 flex-wrap items-center gap-2 px-3 py-2 md:px-4">
        <Button
          asChild
          variant="quiet"
          size="sm"
          className="shrink-0 px-2 text-text-secondary"
        >
          <Link
            to="/sites/$siteId"
            params={{ siteId }}
            aria-label={m.shell_nav_overview()}
          >
            <ArrowLeft weight="bold" />
          </Link>
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="truncate text-[14px] leading-5 font-semibold text-text-primary">
            {label}
          </span>
          <EntryPillView
            status={uiStatus}
            backendStatus={backendStatus}
            scheduledAt={scheduledAt}
            editedSinceReady={editedSinceReady}
            size="sm"
            testId="global-status"
          />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <SaveIndicator
            status={saveStatus}
            isNew={false}
            lastSavedAt={lastSavedAt}
            updatedAt={updatedAt}
            errorCount={errorCount}
            onRetry={onSave}
          />

          <Hint label={previewReason ?? ''}>
            <Button
              type="button"
              variant="quiet"
              size="sm"
              disabled={!previewAvailable || !previewUrl}
              onClick={onPreview}
              data-testid="preview-global"
            >
              <Eye />
              {m.editor_preview()}
            </Button>
          </Hint>

          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={onOpenHistory}
            data-testid="global-history"
          >
            <ClockCounterClockwise />
            {m.globals_history()}
          </Button>

          <Hint label={discardReason ?? ''}>
            <Button
              type="button"
              variant="quiet"
              size="sm"
              disabled={!canDiscard || busy || discardPending}
              onClick={onDiscard}
              data-testid="discard-draft"
            >
              {m.globals_discard_draft()}
            </Button>
          </Hint>

          {canManage ? (
            scheduled ? (
              <Button
                type="button"
                variant="quiet"
                size="sm"
                disabled={busy}
                onClick={onCancelSchedule}
                data-testid="cancel-schedule"
              >
                <CalendarX />
                {m.editor_cancel_schedule()}
              </Button>
            ) : (
              <Popover open={scheduleOpen} onOpenChange={onScheduleOpenChange}>
                <PopoverAnchor asChild>
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    disabled={busy || !hasReady}
                    onClick={() => onScheduleOpenChange(true)}
                    data-testid="schedule-global"
                  >
                    <CalendarDots />
                    {m.editor_schedule()}
                  </Button>
                </PopoverAnchor>
                <PopoverContent
                  align="end"
                  sideOffset={10}
                  className="w-[360px] p-5"
                  data-testid="schedule-popover"
                >
                  <div className="mb-4 grid gap-0.5">
                    <p className="text-headline text-text-primary">
                      {m.editor_schedule_title()}
                    </p>
                    <p className="text-callout text-text-secondary">
                      {m.editor_schedule_description()}
                    </p>
                  </div>
                  <ScheduleForm
                    initialAt={scheduleInitialAt}
                    initialTimeZone={scheduleInitialTimeZone}
                    pending={schedulePending}
                    onCancel={() => onScheduleOpenChange(false)}
                    onSubmit={onScheduleSubmit}
                  />
                </PopoverContent>
              </Popover>
            )
          ) : null}

          <Hint label={markReason ?? ''}>
            <Button
              type="button"
              variant={readyDone ? 'secondary' : 'primary'}
              size="sm"
              disabled={markDisabled}
              loading={markReadyPending}
              onClick={onMarkReady}
              data-testid="mark-ready"
            >
              {readyDone ? (
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-accent"
                />
              ) : (
                <CheckCircle weight="bold" className="max-sm:hidden" />
              )}
              {readyDone ? m.shell_status_ready() : m.collection_mark_ready()}
            </Button>
          </Hint>
        </div>
      </div>
    </header>
  )
}
