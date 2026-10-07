/**
 * Base class for errors whose message is written for the end user and safe to
 * show in the UI (NotFoundError, ConflictError, ValidationError, ...). The
 * server-function error middleware passes these through and replaces every
 * other error with a generic message (see safe-error.ts).
 */
export class AppError extends Error {
  readonly expose = true as const
}
