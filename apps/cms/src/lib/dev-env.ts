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

/**
 * Why a plan item needs attention. The code is stable and the push screen
 * translates it; MCP gets the same code in `attention`.
 * `slug-taken` items cannot be applied: the URL must change in development.
 */
export const PLAN_ATTENTION_CODES = [
  'conflict',
  'drops-content',
  'main-language',
  'scheduled',
  'deleted-in-production',
  'slug-taken',
] as const

export type PlanAttentionCode = (typeof PLAN_ATTENTION_CODES)[number]

/**
 * Attention codes a push never applies, whatever the agency decides: the
 * production schedule or the URL must be resolved first. Shared by the plan
 * (server, apply) and the push screen (Apply switch), so both agree.
 */
export const NEVER_APPLIED_ATTENTION: ReadonlySet<PlanAttentionCode> =
  new Set<PlanAttentionCode>(['scheduled', 'slug-taken'])

/**
 * Plan items whose title is a fixed label the UI translates (the title itself
 * stays English for MCP). Other titles are user content.
 */
export const PLAN_TITLE_CODES = ['site-languages'] as const

export type PlanTitleCode = (typeof PLAN_TITLE_CODES)[number]

/**
 * Warnings a push or a copy reports. `code` and `params` are stable: the UI
 * builds the text from them. `message` is English, for MCP and logs.
 */
export type DevEnvWarning =
  | {
      code: 'section-entry-missing'
      params: { slug: string }
      message: string
    }
  | {
      code: 'collection-missing'
      params: { collectionKey: string }
      message: string
    }
  | {
      code: 'reference-cleared'
      params: { field: string; locale?: string; devTargetId: string }
      message: string
    }
  | {
      /** A rich text link to an entry that is not in production; the text stays. */
      code: 'link-cleared'
      params: { field: string; locale?: string; devTargetId: string }
      message: string
    }
  | {
      /** A push kept production's previous ready version. */
      code: 'ready-not-pushed'
      params: { details: string }
      message: string
    }
  | {
      /** A copy with markReady kept production's previous ready version. */
      code: 'ready-not-copied'
      params: { details: string }
      message: string
    }

export type DevEnvWarningCode = DevEnvWarning['code']

/** A push or copy refused because the production entry it writes has a schedule. */
export const SCHEDULED_IN_PRODUCTION_MESSAGE =
  'Scheduled in production. Resolve the schedule first.'
