import { randomUUID } from 'node:crypto'

import type { CallToolResult } from '@modelcontextprotocol/server'

import { createLogger } from '#/server/log'
import { AssetInUseError, AssetValidationError } from '#/server/assets'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '#/server/content/errors'
import { AppError } from '#/server/http/app-error'
import { RemoteFetchError } from '#/server/assets/remote'

const log = createLogger('mcp')

/**
 * "Not found" with an agent-facing message. The shared NotFoundError only takes
 * translated (Paraglide) text, and tool messages are plain English.
 */
export class McpNotFoundError extends AppError {
  readonly status = 404
  constructor(message: string) {
    super(message)
    this.name = 'McpNotFoundError'
  }
}

export function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] }
}

/**
 * Turns anything a tool handler throws into an agent-readable tool error. The
 * messages are written for the model: they say what went wrong and what to do
 * next. Unknown errors never expose stack traces or SQL; they get a reference
 * id that the server log also records.
 */
export function toToolError(error: unknown): CallToolResult {
  if (error instanceof ValidationError && error.blockers.length > 0) {
    // Language gaps: name each language and its fields, and say how to fill them.
    const fix = error.blockers
      .map(
        (blocker) =>
          `Set locale "${blocker.locale}" and fill in: ${blocker.missing.join(', ')}.`,
      )
      .join(' ')
    return toolError(
      `Not ready yet. ${error.message}. ${fix} Write each one with update_entry (or update_global) and retry. Nothing was changed.`,
    )
  }
  if (error instanceof ValidationError) {
    return toolError(
      `Validation failed. ${error.message}. Fix these fields and call the tool again. Call get_collection_schema for the expected formats.`,
    )
  }
  if (error instanceof ConflictError) {
    if (error.message.startsWith('DRAFT_CONFLICT')) {
      return toolError(
        'This entry changed since you last read it, so your update was not saved. Call get_entry to read the current version, reapply your change, and retry with the new version number.',
      )
    }
    if (/slug/i.test(error.message)) {
      return toolError(
        `${error.message}. Choose a different slug (lowercase letters, numbers and dashes) and retry.`,
      )
    }
    return toolError(error.message)
  }
  if (error instanceof AssetInUseError) {
    return toolError(
      `This asset is still used by ${error.usage} item(s) (entries, revisions or published snapshots). Remove it from them first, then retry.`,
    )
  }
  if (
    error instanceof RemoteFetchError ||
    error instanceof AssetValidationError
  ) {
    return toolError(`Could not import the file: ${error.message}`)
  }
  if (
    error instanceof NotFoundError ||
    error instanceof ForbiddenError ||
    error instanceof McpNotFoundError
  ) {
    return toolError(error.message)
  }
  if (error instanceof AppError) {
    return toolError(error.message)
  }

  const ref = randomUUID().slice(0, 8)
  log.error('MCP tool failed', { ref, err: error })
  return toolError(
    `Something went wrong on the Areca server (ref ${ref}). Nothing was confirmed as saved. Retry once; if it keeps failing, tell the site owner and quote this ref.`,
  )
}
