import type * as React from 'react'
import type { ReactNode, Ref } from 'react'
import { Link } from '@tanstack/react-router'

import { Button, SplitButton } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Spinner } from '#/components/ui/spinner'
import { m } from '#/paraglide/messages'
import {
  Archive,
  ArrowLeft,
  ArrowSquareOut,
  CalendarDots,
  CalendarSlash,
  DotsThree,
  EyeSlash,
  PaperPlaneTilt,
  SlidersHorizontal,
  Trash,
} from '@phosphor-icons/react'

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/**
 * The 56px row that replaces the site identity strip inside the entry editor:
 * back link, what you are editing, save state, and every entry action. Purely
 * presentational; the editor owns the state and the dialogs.
 */
export function EditorToolbar({
  ref,
  siteId,
  collectionKey,
  collectionLabel,
  siteName,
  title,
  statusBadge,
  saving,
  dirty,
  isNew,
  savedLabel,
  canManage,
  actionsReady,
  publishPending,
  scheduled,
  canUnpublish,
  canArchive,
  previewUrl,
  onSave,
  onPublish,
  onSchedule,
  onCancelSchedule,
  onUnpublish,
  onArchive,
  onDelete,
  onOpenDetails,
}: {
  ref?: Ref<HTMLDivElement>
  siteId: string
  collectionKey: string
  collectionLabel: string
  siteName: string
  title: string
  statusBadge: ReactNode
  saving: boolean
  dirty: boolean
  isNew: boolean
  savedLabel: string
  canManage: boolean
  actionsReady: boolean
  publishPending: boolean
  scheduled: boolean
  canUnpublish: boolean
  canArchive: boolean
  previewUrl?: string
  onSave: () => void
  onPublish: () => void
  onSchedule: () => void
  onCancelSchedule: () => void
  onUnpublish: () => void
  onArchive: () => void
  onDelete: () => void
  onOpenDetails: () => void
}) {
  return (
    <div
      ref={ref}
      data-testid="editor-toolbar"
      className="sticky top-(--navbar-height) z-navbar -mx-6 -mt-6 mb-6 border-b border-border-subtle bg-background-default/90 px-6 backdrop-blur"
    >
      <div className="flex h-14 items-center gap-3">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 shrink-0 text-text-secondary"
        >
          <Link
            to="/sites/$siteId/c/$collectionKey"
            params={{ siteId, collectionKey }}
          >
            <ArrowLeft />
            <span className="hidden sm:inline">
              {m.editor_back_to({ name: collectionLabel })}
            </span>
            <span className="sr-only sm:hidden">
              {m.editor_back_to({ name: collectionLabel })}
            </span>
          </Link>
        </Button>

        <span
          aria-hidden="true"
          className="hidden h-5 w-px shrink-0 bg-border-subtle lg:block"
        />

        <div className="hidden min-w-0 shrink items-center gap-2 lg:flex">
          <span className="truncate text-ds-mono-xs text-text-muted">
            {siteName} / {collectionKey}
          </span>
        </div>

        <span
          className="min-w-0 flex-1 truncate text-ds-label-md text-text-primary"
          title={title}
        >
          {title}
        </span>
        <span className="hidden shrink-0 sm:inline-flex">{statusBadge}</span>

        <p className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap text-ds-body-xs text-text-muted md:flex">
          {saving ? (
            <>
              <Spinner size={12} />
              {m.editor_saving()}
            </>
          ) : dirty ? (
            <span
              className="inline-flex items-center gap-1.5 text-text-warning"
              data-testid="entry-dirty"
            >
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-status-warning"
              />
              {m.editor_unsaved_changes()}
            </span>
          ) : (
            <span>{savedLabel}</span>
          )}
        </p>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onSave}
            disabled={saving}
            data-testid="save-draft"
            title={m.editor_save_draft_shortcut({
              shortcut: `${isMac ? '⌘' : 'Ctrl+'}S`,
            })}
          >
            {saving ? <Spinner size={14} /> : null}
            {saving ? m.editor_saving() : m.editor_save_draft()}
          </Button>

          {previewUrl ? (
            <Button asChild variant="ghost" size="sm">
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="preview-entry"
              >
                <ArrowSquareOut />
                <span className="hidden sm:inline">{m.editor_preview()}</span>
              </a>
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled
              data-testid="preview-entry"
              title={isNew ? m.editor_preview_save_first() : undefined}
            >
              <ArrowSquareOut />
              <span className="hidden sm:inline">{m.editor_preview()}</span>
            </Button>
          )}

          {canManage ? (
            <>
              <SplitButton
                variant="primary"
                size="sm"
                label={
                  <>
                    {publishPending ? (
                      <Spinner size={14} />
                    ) : (
                      <PaperPlaneTilt />
                    )}
                    <span className="hidden sm:inline">
                      {m.editor_publish()}
                    </span>
                  </>
                }
                menuLabel={m.editor_publish_options()}
                // Non-modal so a click on the primary action while the menu is
                // open reaches the button instead of an invisible overlay.
                menuProps={{ modal: false }}
                onClick={onPublish}
                disabled={isNew || !actionsReady}
                data-testid="publish-now"
                title={isNew ? m.editor_save_draft_first() : undefined}
                triggerProps={
                  {
                    'data-testid': 'publish-menu',
                  } as React.ComponentProps<'button'>
                }
              >
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel className="text-ds-body-xs font-normal text-text-muted">
                    {dirty
                      ? m.editor_publish_save_first_hint()
                      : m.editor_publish_makes_live_hint()}
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    disabled={!actionsReady}
                    data-testid="schedule-entry"
                    onSelect={onSchedule}
                  >
                    <CalendarDots />
                    {m.editor_schedule_ellipsis()}
                  </DropdownMenuItem>
                  {scheduled ? (
                    <DropdownMenuItem
                      disabled={!actionsReady}
                      data-testid="cancel-schedule"
                      onSelect={onCancelSchedule}
                    >
                      <CalendarSlash />
                      {m.editor_cancel_schedule()}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </SplitButton>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    data-testid="entry-more"
                    disabled={isNew}
                    aria-label={m.editor_more_actions()}
                  >
                    <DotsThree />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    disabled={!actionsReady || !canUnpublish}
                    onSelect={onUnpublish}
                  >
                    <EyeSlash />
                    {m.editor_unpublish()}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!actionsReady || !canArchive}
                    onSelect={onArchive}
                  >
                    <Archive />
                    {m.editor_archive()}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!actionsReady}
                    variant="destructive"
                    onSelect={onDelete}
                  >
                    <Trash />
                    {m.editor_delete_ellipsis()}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label={m.editor_details()}
            data-testid="open-inspector"
            onClick={onOpenDetails}
          >
            <SlidersHorizontal />
          </Button>
        </div>
      </div>
    </div>
  )
}
