import type { ReactNode } from 'react'
import { UploadSimple } from '@phosphor-icons/react'

import {
  DropdownMenuItem,
  DropdownMenuLabel,
} from '#/components/ui/dropdown-menu'
import type { CopyEntryAction } from '#/features/dev-env/use-copy-to-production'
import type { EditorMode } from '#/features/visual/visual-preferences'
import type { EntryUiStatus } from '#/lib/status'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { SaveIndicator } from './save-indicator'
import type { EntryEditorState } from './use-entry-editor'
import type { ReadyBlock } from './use-editor-session'

/** The Write | Visual switch. */
export type VisualModeSwitch = {
  active: boolean
  canVisual: boolean
  disabledReason: string | null
  onSetMode: (mode: EditorMode) => void
}

/** What both editor top bars show the same way. */
export type EditorBarCommon = {
  editor: EntryEditorState
  siteId: string
  uiStatus: EntryUiStatus
  editedSinceReady: boolean
  canManage: boolean
  /**
   * Blocks ready and schedule: a draft conflict (fix reloads the latest
   * version) or a required language (fix switches to it).
   */
  readyBlock: ReadyBlock | null
  /** Copy to production as a draft (development environments only; null elsewhere). */
  copyAction: CopyEntryAction | null
  /** The language bar, rendered as the second row of the sticky header. */
  languageBar?: ReactNode
  /** Omitted where Visual mode is unavailable. */
  visualMode?: VisualModeSwitch
}

/** The editor's save status; during a conflict it says so instead of Retry. */
export function EditorSaveIndicator({
  editor,
  compact,
}: {
  editor: EntryEditorState
  compact?: boolean
}) {
  return (
    <SaveIndicator
      compact={compact}
      status={editor.status}
      conflict={editor.conflict !== null}
      isNew={editor.isNew}
      lastSavedAt={editor.lastSavedAt}
      updatedAt={editor.entry?.updatedAt}
      errorCount={editor.errorCount}
      onRetry={() => void editor.save()}
    />
  )
}

/** The ⋯ menu's "Copy to production", with the reason when it is blocked. */
export function CopyToProductionItem({
  action,
  disabled,
  noteClassName,
}: {
  action: CopyEntryAction
  disabled: boolean
  noteClassName: string
}) {
  return (
    <>
      <DropdownMenuItem
        disabled={action.blockedReason !== null || action.pending || disabled}
        onSelect={action.copy}
        data-testid="copy-to-production"
      >
        <UploadSimple />
        {m.dev_env_copy_menu()}
      </DropdownMenuItem>
      {action.blockedReason ? (
        <DropdownMenuLabel
          className={cn(
            'max-w-64 text-caption font-normal tracking-normal whitespace-normal normal-case',
            noteClassName,
          )}
        >
          {action.blockedReason}
        </DropdownMenuLabel>
      ) : null}
    </>
  )
}
