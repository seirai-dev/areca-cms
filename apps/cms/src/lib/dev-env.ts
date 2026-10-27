/**
 * Shared between the push server code and the push screen, which matches a
 * refused push by its message (server functions only ship messages to the
 * client). Kept here, not in `server/dev-env/push.ts`, so the client does not
 * bundle the database code.
 */
export const PLAN_CHANGED_MESSAGE = 'The plan changed. Review it again.'
