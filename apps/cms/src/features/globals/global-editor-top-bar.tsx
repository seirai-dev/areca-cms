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
import {
  CopyToProductionItem,
  EditorSaveIndicator,
} from '#/features/editor/editor-bar-parts'
import type { EditorBarCommon } from '#/features/editor/editor-bar-parts'
import { ScheduleForm } from '#/features/editor/schedule-form'
import { editorPublishReason } from '#/features/golive/golive-tray'
import { useIsMobile } from '#/hooks/use-mobile'
import { VisualModeControl } from '#/features/visual/visual-mode-control'
import { useVisualModeActive } from '#/features/visual/visual-mode'
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
  editor,
  siteId,
  uiStatus,
  editedSinceReady,
  canManage,
  readyBlock,
  copyAction,
  languageBar,
  visualMode,
  label,
  canSchedule,
  hasReady,
  discardReason,
  preview,
  schedule,
  onOpenHistory,
}: EditorBarCommon & {
  label: string
  /** False on a development environment: no scheduling (Decision 8). */
  canSchedule: boolean
  /** The section has a ready (or scheduled) version. */
  hasReady: boolean
  /** Why Discard draft is unavailable; null when it can discard. */
  discardReason: string | null
  /** The section's preview page; `reason` says why there is none. */
  preview: { available: boolean; reason: string | null; open: () => void }
  schedule: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (at: Date, timeZone: string) => void
  }
  onOpenHistory: () => void
}) {
  const { entry, busy, markable, previewUrl } = editor
  const backendStatus = entry?.status ?? 'draft'
  const scheduled = backendStatus === 'scheduled'
  const canDiscard = discardReason === null
  const onDiscard = () => void editor.discard().catch(() => undefined)
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
    preview.reason,
    discardReason,
    !canManage ? editorPublishReason() : null,
  ].filter((note): note is string => Boolean(note))

  const scheduleButton = (
    <Button
      type="button"
      variant="quiet"
      size="sm"
      disabled={busy || !hasReady || readyBlock !== null}
      onClick={() => schedule.onOpenChange(true)}
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
            scheduledAt={entry?.scheduledAt}
            editedSinceReady={editedSinceReady}
            size="sm"
            testId="global-status"
          />
        </div>

        {visualMode ? <VisualModeControl {...visualMode} /> : null}

        {/* Phones: this group is flattened (contents) so Ready and the ⋯ menu
            sit on the first line and the save status wraps below them. */}
        <Popover open={schedule.open} onOpenChange={schedule.onOpenChange}>
          <div className="flex shrink-0 items-center gap-1 max-md:contents">
            <div className="order-last w-full min-w-0 md:order-none md:mr-1 md:w-auto">
              <EditorSaveIndicator editor={editor} />
            </div>

            <Hint
              label={preview.reason ?? ''}
              className="hidden md:inline-flex"
            >
              <Button
                type="button"
                variant="quiet"
                size="sm"
                disabled={!preview.available || !previewUrl}
                onClick={preview.open}
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
                disabled={!canDiscard || busy || editor.discardPending}
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
                  onClick={editor.cancelSchedule}
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
                loading={editor.markReadyPending}
                onClick={editor.markReady}
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
                  disabled={!preview.available || !previewUrl}
                  onSelect={preview.open}
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
                  disabled={!canDiscard || busy || editor.discardPending}
                  onSelect={onDiscard}
                  data-testid="discard-draft-menu"
                >
                  <ArrowUUpLeft />
                  {m.globals_discard_draft()}
                </DropdownMenuItem>
                {copyAction ? (
                  <>
                    <DropdownMenuSeparator />
                    <CopyToProductionItem
                      action={copyAction}
                      disabled={busy}
                      noteClassName="pt-1 pb-1"
                    />
                  </>
                ) : null}
                {canManage && canSchedule ? (
                  <>
                    <DropdownMenuSeparator />
                    {scheduled ? (
                      <DropdownMenuItem
                        disabled={busy}
                        onSelect={editor.cancelSchedule}
                        data-testid="cancel-schedule-menu"
                      >
                        <CalendarX />
                        {m.editor_cancel_schedule()}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        disabled={busy || !hasReady || readyBlock !== null}
                        onSelect={() => schedule.onOpenChange(true)}
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
                initialAt={
                  entry?.scheduledAt ? new Date(entry.scheduledAt) : null
                }
                initialTimeZone={entry?.scheduleTimezone}
                pending={editor.schedulePending}
                onCancel={() => schedule.onOpenChange(false)}
                onSubmit={schedule.onSubmit}
              />
            </PopoverContent>
          ) : null}
        </Popover>
      </div>
      {languageBar}
    </header>
  )
}
