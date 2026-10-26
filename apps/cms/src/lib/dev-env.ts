/**
 * Shared between the push server code and the push screen, which matches a
 * refused push by its message (server functions only ship messages to the
 * client). Kept here, not in `server/dev-env/push.ts`, so the client does not
 * bundle the database code.
 */
export const PLAN_CHANGED_MESSAGE = 'The plan changed. Review it again.'

/**
 * A copy to production refused because production changed since the last
 * sync. The editor offers Overwrite for it (docs/design/dev-environments.md,
 * Decision 18).
 */
export const COPY_CONFLICT_MESSAGE =
  'Changed in production since the last sync. Copy again with overwrite to replace the production draft.'

/** A copy refused because production has an entry with the same slug that this dev entry is not linked to. */
export const COPY_UNLINKED_MESSAGE =
  'Production already has an entry with this slug that is not linked to this development entry. Copy again with overwrite to replace its draft.'

/** The messages a copy refuses with that Overwrite can resolve. */
export function isCopyOverwriteRefusal(message: string): boolean {
  return message === COPY_CONFLICT_MESSAGE || message === COPY_UNLINKED_MESSAGE
}
