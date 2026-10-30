import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowUUpLeft,
  CalendarDots,
  CalendarX,
  CheckCircle,
  ClockCounterClockwise,
  DotsThree,
  Eye,
  UploadSimple,
  WarningCircle,
} from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Hint } from '#/components/ui/tooltip'
import { Popover, PopoverAnchor, PopoverContent } from '#/components/ui/popover'
import { EntryPillView } from '#/features/collection/entry-pill'
import { SaveIndicator } from '#/features/editor/save-indicator'
import { ScheduleForm } from '#/features/editor/schedule-form'
import type { SaveStatus } from '#/features/editor/use-entry-editor'
import type { CopyEntryAction } from '#/features/dev-env/use-copy-to-production'
import { editorPublishReason } from '#/features/golive/golive-tray'
import { useIsMobile } from '#/hooks/use-mobile'
import { VisualModeControl } from '#/features/visual/visual-mode-control'
import { useVisualModeActive } from '#/features/visual/visual-mode'
import type { EditorMode } from '#/features/visual/visual-preferences'
import type { EntryUiStatus } from '#/lib/status'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/**
 * The section editor's top bar: back to the site, the section label with its
 * status, the save indicator, then the actions (Mark as ready, Schedule, Discard
 * draft, Preview, History). Every action is gated the way entry actions are:
 * owners publish, editors save and discard, and disabled actions say why.
 *
 * Below md the secondary actions move into a ⋯ menu, and the save status
 * drops to its own line, so the bar never wider than the viewport. The menu
 * items reuse the same handlers and gates as the inline buttons.
 */
export function GlobalEditorTopBar({
  siteId,
  label,
  uiStatus,
  backendStatus,
  scheduledAt,
  editedSinceReady,
  saveStatus,
  conflict = false,
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
  canSchedule = true,
  onOpenHistory,
  languageBar,
  readyBlock = null,
  copyAction = null,
  visualMode,
}: {
  siteId: string
  label: string
  uiStatus: EntryUiStatus
  backendStatus: string
  scheduledAt?: string | Date | null
  editedSinceReady: boolean
  saveStatus: SaveStatus
  /** The draft moved on the server; the header says so instead of Retry. */
  conflict?: boolean
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
  /** False on a development environment: no scheduling (Decision 8). */
  canSchedule?: boolean
  onOpenHistory: () => void
  /** The language bar, rendered as the second row of the sticky header. */
  languageBar?: ReactNode
  /**
   * Blocks ready and schedule: a draft conflict (fix reloads the latest
   * version) or a required language (fix switches to it). The reason is
   * clickable.
   */
  readyBlock?: { message: string; onFix: () => void } | null
  /** Copy to production as a draft (development environments only; null elsewhere). */
  copyAction?: CopyEntryAction | null
  /** The Write | Visual switch. Omitted where Visual mode is unavailable. */
  visualMode?: {
    active: boolean
    canVisual: boolean
    disabledReason: string | null
    onSetMode: (mode: EditorMode) => void
  }
}) {
  const mobile = useIsMobile()
  // Full-bleed (Visual mode) drops the page padding the header compensates for.
  const fullBleed = useVisualModeActive()
  // Ready, unchanged since: the button says so and stays disabled.
  const readyDone = hasReady && !markable && backendStatus === 'published'
  const markDisabled = !canManage || busy || readyDone || readyBlock !== null

  const markReason = !canManage
    ? editorPublishReason()
    : readyDone
      ? m.editor_ready_reason()
      : readyBlock
        ? readyBlock.message
        : null

  // Reasons for disabled secondary actions, shown in the ⋯ menu on phones
  // (where there is no hover tooltip).
  const menuNotes = [
    previewReason,
    discardReason,
    !canManage ? editorPublishReason() : null,
  ].filter((note): note is string => Boolean(note))

  const scheduleButton = (
    <Button
      type="button"
      variant="quiet"
      size="sm"
      disabled={busy || !hasReady || readyBlock !== null}
      onClick={() => onScheduleOpenChange(true)}
      data-testid="schedule-global"
      className="hidden md:inline-flex"
    >
      <CalendarDots />
      {m.editor_schedule()}
    </Button>
  )

  const moreButton = (
    <Button
      type="button"
      variant="quiet"
      size="icon-sm"
      className="md:hidden"
      data-testid="global-more"
      aria-label={m.editor_more_actions()}
    >
      <DotsThree weight="bold" />
    </Button>
  )

  return (
    <header
      data-testid="global-toolbar"
      className={cn(
        'sticky top-0 z-navbar border-b border-border-default bg-background-default/85 backdrop-blur-xl',
        !fullBleed && '-mx-4 -mt-6 mb-6 md:-mx-8 md:-mt-10',
      )}
    >
      <div
        className={cn(
          'flex min-h-14 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 md:px-8',
          fullBleed && 'px-3 md:px-4',
        )}
      >
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

        {visualMode ? (
          <VisualModeControl
            active={visualMode.active}
            canVisual={visualMode.canVisual}
            disabledReason={visualMode.disabledReason}
            onSetMode={visualMode.onSetMode}
          />
        ) : null}

        {/* Phones: this group is flattened (contents) so Ready and the ⋯ menu
            sit on the first line and the save status wraps below them. */}
        <Popover open={scheduleOpen} onOpenChange={onScheduleOpenChange}>
          <div className="flex shrink-0 items-center gap-1 max-md:contents">
            <div className="order-last w-full min-w-0 md:order-none md:mr-1 md:w-auto">
              <SaveIndicator
                status={saveStatus}
                conflict={conflict}
                isNew={false}
                lastSavedAt={lastSavedAt}
                updatedAt={updatedAt}
                errorCount={errorCount}
                onRetry={onSave}
              />
            </div>

            <Hint label={previewReason ?? ''} className="hidden md:inline-flex">
              <Button
                type="button"
                variant="quiet"
                size="sm"
                disabled={!previewAvailable || !previewUrl}
                onClick={onPreview}
                data-testid="preview-global"
                className="hidden md:inline-flex"
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
              className="hidden md:inline-flex"
            >
              <ClockCounterClockwise />
              {m.globals_history()}
            </Button>

            <Hint label={discardReason ?? ''} className="hidden md:inline-flex">
              <Button
                type="button"
                variant="quiet"
                size="sm"
                disabled={!canDiscard || busy || discardPending}
                onClick={onDiscard}
                data-testid="discard-draft"
                className="hidden md:inline-flex"
              >
                {m.globals_discard_draft()}
              </Button>
            </Hint>

            {canManage && canSchedule ? (
              scheduled ? (
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  disabled={busy}
                  onClick={onCancelSchedule}
                  data-testid="cancel-schedule"
                  className="hidden md:inline-flex"
                >
                  <CalendarX />
                  {m.editor_cancel_schedule()}
                </Button>
              ) : mobile ? (
                scheduleButton
              ) : (
                <PopoverAnchor asChild>{scheduleButton}</PopoverAnchor>
              )
            ) : null}

            {readyBlock ? (
              // The reason lives in tooltips, not in the bar: the section
              // title keeps its room. The icon switches to the language.
              <Hint label={readyBlock.message}>
                <Button
                  type="button"
                  variant="quiet"
                  size="icon-sm"
                  onClick={readyBlock.onFix}
                  aria-label={readyBlock.message}
                  data-testid="ready-blocker"
                  className="text-status-warning"
                >
                  <WarningCircle weight="fill" />
                </Button>
              </Hint>
            ) : null}
            <Hint label={markReason ?? ''} wrapDisabled={readyBlock !== null}>
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

            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                {/* On phones the menu trigger is the schedule popover's anchor. */}
                {mobile ? (
                  <PopoverAnchor asChild>{moreButton}</PopoverAnchor>
                ) : (
                  moreButton
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  disabled={!previewAvailable || !previewUrl}
                  onSelect={onPreview}
                  data-testid="preview-global-menu"
                >
                  <Eye />
                  {m.editor_preview()}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={onOpenHistory}
                  data-testid="global-history-menu"
                >
                  <ClockCounterClockwise />
                  {m.globals_history()}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canDiscard || busy || discardPending}
                  onSelect={onDiscard}
                  data-testid="discard-draft-menu"
                >
                  <ArrowUUpLeft />
                  {m.globals_discard_draft()}
                </DropdownMenuItem>
                {copyAction ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={
                        copyAction.blockedReason !== null ||
                        copyAction.pending ||
                        busy
                      }
                      onSelect={copyAction.copy}
                      data-testid="copy-to-production"
                    >
                      <UploadSimple />
                      {m.dev_env_copy_menu()}
                    </DropdownMenuItem>
                    {copyAction.blockedReason ? (
                      <DropdownMenuLabel className="max-w-64 pt-1 pb-1 text-caption font-normal tracking-normal whitespace-normal normal-case">
                        {copyAction.blockedReason}
                      </DropdownMenuLabel>
                    ) : null}
                  </>
                ) : null}
                {canManage && canSchedule ? (
                  <>
                    <DropdownMenuSeparator />
                    {scheduled ? (
                      <DropdownMenuItem
                        disabled={busy}
                        onSelect={onCancelSchedule}
                        data-testid="cancel-schedule-menu"
                      >
                        <CalendarX />
                        {m.editor_cancel_schedule()}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        disabled={busy || !hasReady || readyBlock !== null}
                        onSelect={() => onScheduleOpenChange(true)}
                        data-testid="schedule-global-menu"
                      >
                        <CalendarDots />
                        {m.editor_schedule()}
                      </DropdownMenuItem>
                    )}
                  </>
                ) : null}
                {menuNotes.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    {menuNotes.map((note) => (
                      <DropdownMenuLabel
                        key={note}
                        className="max-w-64 pt-1 pb-1 text-caption font-normal tracking-normal whitespace-normal normal-case"
                      >
                        {note}
                      </DropdownMenuLabel>
                    ))}
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {canManage && !scheduled ? (
            <PopoverContent
              align="end"
              sideOffset={10}
              className="w-[360px] max-w-[calc(100vw-2rem)] p-5"
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
          ) : null}
        </Popover>
      </div>
      {languageBar}
    </header>
  )
}
