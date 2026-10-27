import { z } from '#/lib/zod'

import { db } from '#/db'
import { ForbiddenError, ValidationError } from '#/server/content/errors'
import { forkDevEnvironment } from '#/server/dev-env/fork'
import { copyEntryToProduction } from '#/server/dev-env/copy'
import { loadPlan, countUnpushedChanges } from '#/server/dev-env/load-plan'
import type { PlanItem } from '#/server/dev-env/plan'
import { pushDevEnvironment } from '#/server/dev-env/push'
import { refreshDevEnvironment } from '#/server/dev-env/refresh'

import { goLiveDeniedMessage } from '../guard'
import { mcpResourceUrl } from '../oauth-resource'
import { loadEntryInSite } from '../scope'
import { idSchema } from '../schemas'
import { DEVELOPMENT_ONLY, PRODUCTION_ONLY } from '../tool-kit'
import type { ToolRegistry } from '../tool-kit'

/** Plan item ids: `schema:<key>`, `languages`, or `entry:<devId>`. */
const ITEM_ID_MAX_LENGTH = 300
/** A push can list many items; this bounds one call, not the plan. */
const MAX_ITEM_IDS = 1000

const itemIds = z
  .array(z.string().min(1).max(ITEM_ID_MAX_LENGTH))
  .max(MAX_ITEM_IDS)

/**
 * One line a model can show the user for a plan item: what changed, in
 * words, without the field payloads.
 */
function summarize(item: PlanItem): string {
  const collisions = (item.summary.slugCollisions ?? []).map((collision) => {
    const url =
      collision.locale !== undefined
        ? `${collision.locale} URL "${collision.slug}"`
        : `URL "${collision.slug}"`
    return `${url} is already used by "${collision.collidesWith}" (cannot apply; change the URL in development)`
  })
  return [changeSummary(item), ...collisions].join('; ')
}

function changeSummary(item: PlanItem): string {
  const parts: string[] = []
  const { summary } = item
  if (item.kind === 'entry.new') return 'new entry'
  if (item.kind === 'entry.archive') return 'archives the production entry'
  if (item.kind === 'languages') {
    return summary.stampCount
      ? `languages changed, stamps ${summary.stampCount} entries`
      : 'languages changed'
  }
  if (summary.changedFields && summary.changedFields.length > 0) {
    parts.push(
      `${summary.changedFields.length} field(s) changed: ${summary.changedFields.join(', ')}`,
    )
  }
  if (summary.readyChanged && summary.draftChanged) {
    parts.push('ready and draft')
  } else if (summary.readyChanged) {
    parts.push('ready version')
  } else if (summary.draftChanged) {
    parts.push('draft')
  }
  for (const dropped of summary.droppedFields ?? []) {
    parts.push(
      `removes field "${dropped.key}", archives ${dropped.values} value(s)`,
    )
  }
  if (parts.length === 0) {
    return item.kind.startsWith('schema.') ? 'schema change' : 'changed'
  }
  return parts.join('; ')
}

function describeItem(item: PlanItem) {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    collection: item.collectionLabel ?? item.collectionKey,
    summary: summarize(item),
    attention: item.attention,
  }
}

export function registerDevEnvTools(registry: ToolRegistry): void {
  registry.add({
    name: 'create_dev_environment',
    title: 'Create development environment',
    description:
      'Agency admin only, on the production connector. Creates the development environment of this production site: a copy of its schema and its ready content, with no publications and no releases. The call returns the slug and the connector URL of the new environment, not its tokens. The tokens are shown only once, in the browser that created the environment, and this connector never returns them. If the user missed them, tell them: open the development environment in the CMS, go to Settings › Developer and rotate the site token (and the schema token for code-first sites) to get new values. Fails if the site already has a development environment. Pass confirm: true.',
    inputSchema: z.object({
      confirm: z
        .literal(true)
        .describe(
          'Must be true. Creating the environment is not undoable here.',
        ),
    }),
    access: 'agency',
    environments: PRODUCTION_ONLY,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    run: async (_input, actor) => {
      const created = await forkDevEnvironment(
        { id: actor.userId },
        actor.siteId,
      )
      return {
        devSlug: created.slug,
        devConnectorUrl: mcpResourceUrl(created.slug),
        counts: created.counts,
        message:
          'The development environment is ready. Its tokens are shown only once, in the browser that created it. Open the development environment in the CMS, go to Settings › Developer and rotate the site token (and the schema token for code-first sites) to get new values.',
      }
    },
  })

  registry.add({
    name: 'refresh_from_production',
    title: 'Reset development from production',
    description:
      'Agency admin only, on a development connector. Throws away everything in this development environment and copies production again (schema and ready content). Unpushed changes are discarded, not archived: the result says how many. Pass confirm: true. Ask the user first when there are unpushed changes; the push_to_production dry run lists them.',
    inputSchema: z.object({
      confirm: z
        .literal(true)
        .describe('Must be true. The unpushed changes are lost.'),
    }),
    access: 'agency',
    environments: DEVELOPMENT_ONLY,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    run: async (_input, actor) => {
      const discardedChanges = await countUnpushedChanges(actor.siteId)
      const counts = await refreshDevEnvironment(
        { id: actor.userId },
        actor.siteId,
      )
      return {
        counts: {
          collections: counts.collections,
          sections: counts.sections,
          entries: counts.entries,
        },
        discardedChanges,
        message:
          'The development environment now matches production. Pull again to get the new content.',
      }
    },
  })

  registry.add({
    name: 'push_to_production',
    title: 'Push development to production',
    description:
      'Agency admin only, on a development connector. Pushes changes from this development environment to its production site. ALWAYS call it first with dryRun true (the default): it lists every change since the last push or reset, marks the items that need attention, and returns a planHash and the list. Show that list to the user and get their approval before pushing. Then call again with dryRun false, the planHash from the dry run, and what the user decided: exclude (item ids to leave out) and apply (ids of needs-attention items to apply; they are skipped otherwise). Items marked "scheduled" (the production entry has a schedule) or "slug-taken" (a URL is used by another entry) cannot be applied: resolve the schedule in production, or change the URL in development, then dry run again. goLive true also starts a production build after the push and needs the go-live permission. If production changed after the dry run, the call fails with "The plan changed"; run the dry run again. Pushing never deletes production content: removed entries are archived.',
    inputSchema: z.object({
      dryRun: z
        .boolean()
        .default(true)
        .describe(
          'true (default) lists the changes and writes nothing. false pushes.',
        ),
      planHash: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
          'The planHash from the dry run. Required when dryRun is false.',
        ),
      exclude: itemIds
        .optional()
        .describe('Item ids from the dry run that the user unticked.'),
      apply: itemIds
        .optional()
        .describe(
          'Ids of needs-attention items the user approved. Other needs-attention items are skipped.',
        ),
      goLive: z
        .boolean()
        .default(false)
        .describe(
          'true starts a production build after the push. Needs the go-live permission.',
        ),
    }),
    access: 'agency',
    environments: DEVELOPMENT_ONLY,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    run: async (input, actor) => {
      if (input.dryRun) {
        const plan = await loadPlan(db, actor.siteId)
        const items = plan.items.map(describeItem)
        return {
          dryRun: true,
          planHash: plan.planHash,
          items,
          needsAttention: items.filter((item) => item.attention !== null),
          message:
            'Show this list to the user and get their approval before pushing. Then call push_to_production with dryRun false and this planHash, with exclude and apply as the user decided.',
        }
      }
      if (input.planHash === undefined) {
        throw new ValidationError([
          {
            path: 'planHash',
            message:
              'Send the planHash from a dry run. Call push_to_production with dryRun true first and show the list to the user.',
          },
        ])
      }
      if (input.goLive && !actor.allowGoLive) {
        throw new ForbiddenError(goLiveDeniedMessage(actor.credential))
      }
      const result = await pushDevEnvironment(
        { id: actor.userId },
        {
          devSiteId: actor.siteId,
          planHash: input.planHash,
          exclude: input.exclude ?? [],
          apply: input.apply ?? [],
          goLive: input.goLive,
        },
      )
      const publication = result.publication
      return {
        dryRun: false,
        counts: result.counts,
        warnings: result.warnings,
        written: result.written.map((row) => ({
          itemId: row.itemId,
          productionId: row.productionId,
        })),
        goLive:
          publication === null
            ? null
            : publication.ok
              ? {
                  queued: true,
                  publicationId: publication.publication.id,
                  jobId: publication.job?.id ?? null,
                }
              : { queued: false, reason: publication.errors.join(' ') },
      }
    },
  })

  registry.add({
    name: 'copy_entry_to_production',
    title: 'Copy entry to production as draft',
    description:
      'Agency admin only, on a development connector. Copies one development entry (id from list_entries on this connector) into production as the draft of the matching production entry. The live site never changes until a release. With markReady, the copied draft also becomes the production ready version, checked the same way a push checks it (if the check fails the draft is still copied and the warnings say why). Ready is not live either: the change reaches the live site only after a release (go_live). Refused when the production schema of the collection differs from the development schema ("Push the schema first"), when production changed since the last sync unless overwrite is true, and when a URL (the slug or a localized slug) is already used by another production entry. References are mapped; references that cannot be mapped are cleared and listed in clearedReferences.',
    inputSchema: z.object({
      id: idSchema('development entry'),
      markReady: z
        .boolean()
        .default(false)
        .describe(
          'true also makes the copied draft the production ready version (not live until a release).',
        ),
      overwrite: z
        .boolean()
        .default(false)
        .describe(
          'true replaces a production draft that changed since the last sync.',
        ),
    }),
    access: 'agency',
    environments: DEVELOPMENT_ONLY,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    run: async (input, actor) => {
      // The entry must be on this connector's site, not just any dev env.
      await loadEntryInSite(actor, input.id)
      const result = await copyEntryToProduction(
        { id: actor.userId },
        {
          devEntryId: input.id,
          markReady: input.markReady,
          overwrite: input.overwrite,
        },
      )
      return {
        productionId: result.productionId,
        created: result.created,
        warnings: result.warnings,
        clearedReferences: result.clearedReferences,
      }
    },
  })
}
