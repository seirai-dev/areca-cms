import type { ReactNode } from 'react'
import { WarningCircle } from '@phosphor-icons/react'

import type { Field } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { EditorConflictNotice } from './conflict-notice'
import { fieldLabels } from './language-state'
import type { EntryEditorState } from './use-entry-editor'

/**
 * The notices above an editor's fields, in this order: a draft conflict or
 * recovered copy, fields a restore skipped, `children` (the entry editor's
 * scheduled version), and the save errors with links to each field.
 */
export function EditorNotices({
  editor,
  fields,
  onReveal,
  className,
  children,
}: {
  editor: EntryEditorState
  fields: Field[]
  onReveal: (key: string) => void
  /** Width classes, applied to each notice. */
  className?: string
  children?: ReactNode
}) {
  const errorKeys = Object.keys(editor.fieldErrors).filter(Boolean)
  const hasErrors = editor.errorCount > 0 || Boolean(editor.formError)
  return (
    <>
      <EditorConflictNotice
        conflict={editor.conflict}
        recoveredDraft={Boolean(editor.recoveredDraft)}
        className={cn(
          'grid gap-3 rounded-card border border-border-error/30 p-4',
          className,
        )}
        onReload={() => void editor.reloadServerDraft()}
        onReapply={() => void editor.reapplyRecoveredDraft()}
        onDiscard={editor.discardRecoveredDraft}
      />
      {editor.restoreSkippedFields.length > 0 ? (
        <section
          role="status"
          className={cn(
            'grid gap-2 rounded-card border border-border-default bg-status-warning-bg p-4',
            className,
          )}
        >
          <h2 className="text-headline text-text-primary">
            {m.editor_revision_skipped_fields()}
          </h2>
          <p className="text-callout text-text-secondary">
            {m.editor_revision_keep_current()}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-callout">
            {editor.restoreSkippedFields.map((field) => (
              <li key={field.key}>
                <strong>{field.label}</strong>: {field.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {children}
      {hasErrors ? (
        <div
          role="alert"
          data-testid="editor-errors"
          className={cn(
            'flex items-start gap-3 rounded-card border border-border-error/30 bg-status-error-bg px-4 py-3 text-[14px] leading-5 text-text-primary',
            className,
          )}
        >
          <WarningCircle
            weight="fill"
            className="mt-0.5 size-4 shrink-0 text-icon-error"
          />
          <span className="grid gap-0.5">
            <span className="font-medium">
              {editor.errorCount > 0
                ? editor.errorCount === 1
                  ? m.editor_save_fix_one()
                  : m.editor_save_fix_other({ count: editor.errorCount })
                : m.editor_save_failed()}
            </span>
            {errorKeys.length > 0 ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {errorKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onReveal(key)}
                    className="text-callout font-medium text-text-primary underline decoration-border-error underline-offset-4 hover:decoration-current"
                  >
                    {fieldLabels([key], fields)[0] ?? key}
                  </button>
                ))}
              </span>
            ) : null}
            {editor.formError ? (
              <span className="text-callout text-text-secondary">
                {editor.formError}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
    </>
  )
}
