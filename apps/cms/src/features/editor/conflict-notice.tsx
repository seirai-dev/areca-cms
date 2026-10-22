import { m } from '#/paraglide/messages'

/**
 * Shown when the draft moved on the server. A save conflict keeps the local
 * changes in this browser; an approval conflict (Mark ready or Schedule) only
 * offers the latest version, because nothing was approved.
 */
export function EditorConflictNotice({
  conflict,
  approvalConflict,
  recoveredDraft,
  className,
  onReload,
  onReapply,
  onDiscard,
}: {
  conflict: boolean
  approvalConflict: boolean
  recoveredDraft: boolean
  className: string
  onReload: () => void
  onReapply: () => void
  onDiscard: () => void
}) {
  if (!conflict && !recoveredDraft) return null
  return (
    <div role="alert" className={className}>
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
