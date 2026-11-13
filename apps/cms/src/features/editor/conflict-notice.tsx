import { m } from '#/paraglide/messages'

import type { DraftConflict } from './use-entry-editor'

/** The header save status scrolls to this notice during a conflict. */
export const CONFLICT_NOTICE_ID = 'editor-conflict-notice'

/**
 * While the notice is up, approving would approve a draft nobody has
 * reviewed, so Mark ready and Schedule wait for the latest version. The
 * editors pass this block ahead of their language blocker.
 */
export function conflictReadyBlock(conflict: boolean, onReload: () => void) {
  return conflict
    ? { message: m.editor_conflict_blocks_ready(), onFix: onReload }
    : null
}

/**
 * Shown when the draft moved on the server. A save conflict keeps the local
 * changes in this browser; an approval conflict (Mark ready or Schedule) only
 * offers the latest version, because nothing was approved.
 */
export function EditorConflictNotice({
  conflict,
  recoveredDraft,
  className,
  onReload,
  onReapply,
  onDiscard,
}: {
  conflict: DraftConflict
  recoveredDraft: boolean
  className: string
  onReload: () => void
  onReapply: () => void
  onDiscard: () => void
}) {
  if (!conflict && !recoveredDraft) return null
  const approvalConflict = conflict === 'approval'
  return (
    <div id={CONFLICT_NOTICE_ID} role="alert" className={className}>
      <p>
        {approvalConflict
          ? m.editor_entry_changed_notice()
          : conflict
            ? m.editor_draft_conflict_notice()
            : m.editor_draft_recovered_notice()}
      </p>
      <div className="flex flex-wrap gap-4">
        <button type="button" className="underline" onClick={onReload}>
          {m.editor_reload_server_draft()}
        </button>
        {approvalConflict ? null : (
          <button type="button" className="underline" onClick={onReapply}>
            {m.editor_reapply_recovered_draft()}
          </button>
        )}
        {conflict ? null : (
          <button type="button" className="underline" onClick={onDiscard}>
            {m.editor_discard_recovered_draft()}
          </button>
        )}
      </div>
    </div>
  )
}
