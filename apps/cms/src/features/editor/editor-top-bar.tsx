import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  Archive,
  ArrowLeft,
  ArrowUUpLeft,
  CalendarDots,
  CalendarX,
  CheckCircle,
  Copy,
  DotsThree,
  Eye,
  FloppyDisk,
  LinkSimple,
  RocketLaunch,
  SidebarSimple,
  TextAa,
  Sparkle,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import { toast } from 'sonner'

import { Button, SplitButton } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { useModifierKey } from '#/components/ui/kbd'
import { Hint } from '#/components/ui/tooltip'
import { EntryPillView } from '#/features/collection/entry-pill'
import { editorPublishReason } from '#/features/golive/golive-tray'
import { FADE } from '#/lib/motion'
import type { EntryUiStatus } from '#/lib/status'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { SaveIndicator } from './save-indicator'
import type { SaveStatus } from './use-entry-editor'

export type PrimaryState = 'new' | 'mark' | 'ready' | 'live'

/**
 * The editor's 56px top bar (brief §3.5): back to the collection, the small
 * title (fades in once the big one scrolls away) with the status pill, the
 * save indicator and a quiet Save, Preview, ⋯, the primary split button
 * ("Mark as ready" ▾) and the details toggle.
 */
export function EditorTopBar({
  siteId,
  collectionKey,
  collectionLabel,
  title,
  showTitle,
  uiStatus,
  backendStatus,
  scheduledAt,
  editedSinceReady,
  saveStatus,
  isNew,
  lastSavedAt,
  updatedAt,
  errorCount,
  onSave,
  previewUrl,
  canManage,
  primary,
  busy,
  primaryPending,
  scheduled,
  canUnpublish,
  canArchive,
  hasRichText,
  previewing,
  onTogglePreviewing,
  onGenerateSeo,
  onMarkReady,
  onGoLiveNow,
  goLiveBlocked = false,
  onSchedule,
  onCancelSchedule,
  onUnpublish,
  onArchive,
  onDelete,
  detailsOpen,
  onToggleDetails,
  entryId,
  scheduleAnchor,
  languageBar,
  readyBlock = null,
}: {
  siteId: string
  collectionKey: string
  collectionLabel: string
  title: string
  showTitle: boolean
  uiStatus: EntryUiStatus
  backendStatus: string
  scheduledAt?: string | Date | null
  editedSinceReady: boolean
  saveStatus: SaveStatus
  isNew: boolean
  lastSavedAt: Date | null
  updatedAt?: string | Date
  errorCount: number
  onSave: () => void
  previewUrl?: string
  canManage: boolean
  primary: PrimaryState
  busy: boolean
  primaryPending: boolean
  scheduled: boolean
  canUnpublish: boolean
  canArchive: boolean
  hasRichText: boolean
  previewing: boolean
  onTogglePreviewing: () => void
  /** Opens the AI SEO dialog. Omitted when AI is not set up. */
  onGenerateSeo?: () => void
  onMarkReady: () => void
  onGoLiveNow: () => void
  /** A blocked site cannot go live; the menu item stays visible but disabled. */
  goLiveBlocked?: boolean
  onSchedule: () => void
  onCancelSchedule: () => void
  onUnpublish: () => void
  onArchive: () => void
  onDelete: () => void
  detailsOpen: boolean
  onToggleDetails: () => void
  entryId?: string
  /** Wraps the split button so the schedule popover can anchor to it. */
  scheduleAnchor: (node: React.ReactElement) => React.ReactElement
  /** The language bar, rendered as the second row of the sticky header. */
  languageBar?: React.ReactNode
  /**
   * Set when a required language blocks ready and schedule. The primary
   * action is disabled, and the menu offers the reason, which switches to
   * that language.
   */
  readyBlock?: { message: string; onFix: () => void } | null
}) {
  const reduce = useReducedMotion()
  const mod = useModifierKey()
  const saving = saveStatus === 'saving'

  const primaryLabel =
    primary === 'ready'
      ? m.shell_status_ready()
      : primary === 'live'
        ? m.shell_status_live()
        : m.collection_mark_ready()
  const primaryIcon =
    primary === 'live' ? (
      <span
        aria-hidden="true"
        className="size-2 rounded-full bg-status-success"
      />
    ) : primary === 'ready' ? (
      <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
    ) : (
      <CheckCircle weight="bold" className="max-sm:hidden" />
    )
  const primaryDisabled =
    !canManage || busy || primary !== 'mark' || readyBlock !== null
  const primaryReason = !canManage
    ? editorPublishReason()
    : readyBlock
      ? readyBlock.message
      : primary === 'new'
        ? m.editor_mark_ready_new_reason()
        : primary === 'ready'
          ? m.editor_ready_reason()
          : primary === 'live'
            ? m.editor_live_reason()
            : ''

  const split = (
    <SplitButton
      size="sm"
      variant={
        primary === 'ready' || primary === 'live' ? 'secondary' : 'primary'
      }
      label={
        <>
          {primaryIcon}
          <span>{primaryLabel}</span>
        </>
      }
      loading={primaryPending}
      disabled={primaryDisabled}
      menuDisabled={!canManage || busy || primary === 'new'}
      menuLabel={m.editor_publish_options()}
      menuProps={{ modal: false }}
      onClick={onMarkReady}
      data-testid="publish-now"
      aria-label={primaryLabel}
      triggerProps={{ 'data-testid': 'publish-menu' }}
    >
      <DropdownMenuContent align="end" className="w-72">
        {readyBlock ? (
          <>
            <DropdownMenuItem
              onSelect={readyBlock.onFix}
              data-testid="ready-blocker"
              className="whitespace-normal text-status-warning"
            >
              <WarningCircle weight="fill" />
              {readyBlock.message}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {primary === 'mark' || primary === 'ready' ? (
          <DropdownMenuItem
            onSelect={onGoLiveNow}
            disabled={goLiveBlocked || readyBlock !== null}
            data-testid="go-live-now"
          >
            <RocketLaunch />
            {primary === 'mark'
              ? m.editor_mark_ready_go_live()
              : m.editor_go_live_now()}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onSelect={onSchedule}
          disabled={readyBlock !== null}
          data-testid="schedule-entry"
        >
          <CalendarDots />
          {m.editor_schedule_ellipsis()}
        </DropdownMenuItem>
        {scheduled ? (
          <DropdownMenuItem
            onSelect={onCancelSchedule}
            data-testid="cancel-schedule"
          >
            <CalendarX />
            {m.editor_cancel_schedule()}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="pb-2 text-caption font-normal tracking-normal whitespace-normal normal-case">
          {m.editor_ready_explainer()}
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </SplitButton>
  )

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(done)
    } catch {
      toast.error(m.ui_copy_failed())
    }
  }

  return (
    <header
      data-testid="editor-toolbar"
      className="sticky top-0 z-navbar -mx-6 -mt-6 mb-6 border-b border-border-default bg-background-default/85 backdrop-blur-xl md:-mx-6"
    >
      <div className="flex h-14 items-center gap-2 px-3 md:px-4">
        <Button
          asChild
          variant="quiet"
          size="sm"
          className="shrink-0 px-2 text-text-secondary"
        >
          <Link
            to="/sites/$siteId/c/$collectionKey"
            params={{ siteId, collectionKey }}
            aria-label={m.editor_back_to({ name: collectionLabel })}
            data-testid="editor-back"
          >
            <ArrowLeft weight="bold" />
            <span className="hidden max-w-40 truncate sm:inline">
              {collectionLabel}
            </span>
          </Link>
        </Button>
        <span
          aria-hidden="true"
          className="hidden h-5 w-px shrink-0 bg-border-default sm:block"
        />
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <AnimatePresence initial={false}>
            {showTitle ? (
              <motion.span
                key="title"
                className="hidden min-w-0 truncate text-[14px] leading-5 font-semibold text-text-primary md:block"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={FADE}
                title={title}
              >
                {title}
              </motion.span>
            ) : null}
          </AnimatePresence>
          {/* On phones the primary button already says Ready / Live; keep
              the pill for the states it does not name. */}
          <span
            className={cn(
              'flex min-w-0',
              (primary === 'ready' || primary === 'live') && 'max-sm:hidden',
            )}
          >
            <EntryPillView
              status={uiStatus}
              backendStatus={backendStatus}
              scheduledAt={scheduledAt}
              editedSinceReady={editedSinceReady}
              size="sm"
              testId="entry-status"
            />
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <div className="mr-1 hidden min-w-0 md:block">
            <SaveIndicator
              status={saveStatus}
              isNew={isNew}
              lastSavedAt={lastSavedAt}
              updatedAt={updatedAt}
              errorCount={errorCount}
              onRetry={onSave}
            />
          </div>
          <div className="md:hidden">
            <SaveIndicator
              compact
              status={saveStatus}
              isNew={isNew}
              lastSavedAt={lastSavedAt}
              updatedAt={updatedAt}
              errorCount={errorCount}
              onRetry={onSave}
            />
          </div>
          <Hint label={m.editor_save_now_hint({ shortcut: `${mod}S` })}>
            <Button
              type="button"
              variant="quiet"
              size="sm"
              className="hidden px-2.5 sm:inline-flex"
              onClick={onSave}
              disabled={saving}
              data-testid="save-draft"
            >
              {m.editor_save()}
            </Button>
          </Hint>
          {onGenerateSeo ? (
            <Hint label={m.editor_seo_generate()}>
              <Button
                type="button"
                variant="quiet"
                size="icon-sm"
                className="hidden sm:inline-flex"
                onClick={onGenerateSeo}
                data-testid="topbar-ai-seo"
                aria-label={m.editor_seo_generate()}
              >
                <Sparkle weight="fill" className="text-icon-accent" />
              </Button>
            </Hint>
          ) : null}
          {previewUrl ? (
            <Hint label={m.editor_preview_hint()}>
              <Button
                asChild
                variant="quiet"
                size="icon-sm"
                className="hidden sm:inline-flex"
              >
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="preview-entry"
                  aria-label={m.editor_preview()}
                >
                  <Eye />
                </a>
              </Button>
            </Hint>
          ) : (
            <Hint
              label={
                isNew
                  ? m.editor_preview_save_first_reason()
                  : m.editor_preview_no_slug()
              }
            >
              <Button
                type="button"
                variant="quiet"
                size="icon-sm"
                disabled
                className="hidden sm:inline-flex"
                data-testid="preview-entry"
                aria-label={m.editor_preview()}
              >
                <Eye />
              </Button>
            </Hint>
          )}

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="quiet"
                size="icon-sm"
                data-testid="entry-more"
                aria-label={m.editor_more_actions()}
              >
                <DotsThree weight="bold" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem className="sm:hidden" onSelect={onSave}>
                <FloppyDisk />
                {m.editor_save_now()}
              </DropdownMenuItem>
              {previewUrl ? (
                <DropdownMenuItem asChild className="sm:hidden">
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Eye />
                    {m.editor_preview()}
                  </a>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                disabled={!entryId}
                onSelect={() =>
                  void copy(window.location.href, m.editor_link_copied())
                }
                data-testid="copy-entry-link"
              >
                <LinkSimple />
                {m.editor_copy_link()}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!entryId}
                onSelect={() =>
                  entryId && void copy(entryId, m.editor_id_copied())
                }
                data-testid="copy-entry-id-menu"
              >
                <Copy />
                {m.editor_copy_id()}
              </DropdownMenuItem>
              {hasRichText ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={previewing}
                    onCheckedChange={onTogglePreviewing}
                    data-testid="preview-formatting"
                  >
                    <TextAa />
                    {m.editor_preview_formatting()}
                  </DropdownMenuCheckboxItem>
                </>
              ) : null}
              <DropdownMenuSeparator />
              {canUnpublish ? (
                <DropdownMenuItem
                  disabled={!canManage || busy}
                  onSelect={onUnpublish}
                  data-testid="unpublish-entry"
                >
                  <ArrowUUpLeft />
                  {m.collection_move_to_draft()}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                disabled={!canManage || busy || !canArchive || !entryId}
                onSelect={onArchive}
                data-testid="archive-entry"
              >
                <Archive />
                {m.editor_archive()}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                className="data-[disabled]:text-text-disabled! data-[disabled]:*:[svg]:text-text-disabled!"
                disabled={!canManage || busy || !entryId}
                onSelect={onDelete}
                data-testid="delete-entry"
              >
                <Trash />
                {m.editor_delete_ellipsis()}
              </DropdownMenuItem>
              {canManage ? null : (
                <DropdownMenuLabel className="max-w-64 pt-2 pb-2 text-caption font-normal tracking-normal whitespace-normal normal-case">
                  {editorPublishReason()}
                </DropdownMenuLabel>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="ml-1">
            {primaryReason ? (
              <Hint
                label={primaryReason}
                wrapDisabled={
                  primaryDisabled && (!canManage || readyBlock !== null)
                }
              >
                {scheduleAnchor(split)}
              </Hint>
            ) : (
              scheduleAnchor(split)
            )}
          </div>

          <Hint
            label={
              <span className="inline-flex items-center gap-1.5">
                {m.editor_details()}
                <span className="opacity-60">{mod}.</span>
              </span>
            }
          >
            <Button
              type="button"
              variant="quiet"
              size="icon-sm"
              aria-label={m.editor_details()}
              aria-pressed={detailsOpen}
              onClick={onToggleDetails}
              data-testid="toggle-details"
              className={cn(
                'ml-1',
                detailsOpen && 'bg-surface-state-hover text-text-primary',
              )}
            >
              <SidebarSimple
                weight={detailsOpen ? 'fill' : 'regular'}
                className="-scale-x-100"
              />
            </Button>
          </Hint>
        </div>
      </div>
      {languageBar}
    </header>
  )
}
