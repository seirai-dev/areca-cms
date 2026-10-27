import { z } from '#/lib/zod'

import { applyBulkEntryAction } from '#/server/content/entry-actions'
import {
  archiveEntry,
  cancelSchedule,
  deleteEntry,
  publishEntry,
  restoreRevision,
  scheduleEntry,
  unpublishEntry,
} from '#/server/content/entries'
import { ValidationError } from '#/server/content/errors'

import { toolErrorMessage } from '../errors'
import { formatStoredEntry, withImportWarnings } from './entries'
import { loadEntryInSite } from '../scope'
import { idSchema } from '../schemas'
import { GO_LIVE_PERMISSION_NOTE, PRODUCTION_ONLY } from '../tool-kit'
import type { ToolCollector } from '../tool-kit'

const OWNER_ONLY =
  'Only site owners can do this. Ask a site owner, or leave the entry as it is.'

/** Most entry ids one mark_ready call approves. */
const MARK_READY_MAX_IDS = 200

/** Said after mark_ready, so the agent reports the state accurately. */
export const APPROVED_MESSAGE =
  'Approved. It will go live with the next release (go_live or an owner pressing Go live).'

const expectedVersion = z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    'The "version" you last read with get_entry. Omit to use the current version.',
  )

export function registerEntryWorkflowTools(registry: ToolCollector): void {
  registry.add({
    name: 'mark_ready',
    title: 'Mark entry ready',
    description:
      'Owner action. Marks an entry ready: approves its current draft for the next release. The entry status becomes ready. It does NOT change the live site: the approved version goes live with the next release (go_live, or an owner pressing Go live in the CMS). Required fields are checked here and the error names any that are missing. Pass id for one entry, or ids (up to 200) to approve several at once: each id gets its own result, and one failure does not stop the others. Pass expectedVersion (the version from get_entry) with id to approve exactly the draft you reviewed; if the entry changed since, the call fails with a conflict and nothing is approved. expectedVersion cannot be used with ids. Check live and pendingRelease in the result.',
    inputSchema: z.object({
      id: idSchema('entry').optional(),
      ids: z
        .array(idSchema('entry'))
        .min(1)
        .max(MARK_READY_MAX_IDS)
        .optional()
        .describe(
          `Several entry ids to mark ready, at most ${MARK_READY_MAX_IDS}. Returns a result per id.`,
        ),
      expectedVersion,
    }),
    access: 'owner',
    deniedMessage:
      'Only site owners can mark entries ready. Ask an owner, or leave it as a draft.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      if (input.ids === undefined) {
        if (input.id === undefined) {
          throw new ValidationError([
            {
              path: 'id',
              message: 'Send id for one entry, or ids for several.',
            },
          ])
        }
        const entry = await loadEntryInSite(actor, input.id)
        const published = await publishEntry(
          entry.id,
          actor.userId,
          input.expectedVersion,
        )
        return withImportWarnings(
          {
            message: APPROVED_MESSAGE,
            ...(await formatStoredEntry(actor, entry.id)),
          },
          published.importWarnings,
        )
      }
      if (input.expectedVersion !== undefined) {
        throw new ValidationError([
          {
            path: 'expectedVersion',
            message: 'expectedVersion applies to one entry. Send id, not ids.',
          },
        ])
      }
      const ids = [...new Set([...(input.id ? [input.id] : []), ...input.ids])]
      const results: { id: string; ok: boolean; error?: string }[] = []
      for (const id of ids) {
        try {
          await loadEntryInSite(actor, id)
          await applyBulkEntryAction('ready', id, actor.userId)
          results.push({ id, ok: true })
        } catch (error) {
          results.push({ id, ok: false, error: toolErrorMessage(error) })
        }
      }
      return { message: APPROVED_MESSAGE, results }
    },
  })

  registry.add({
    name: 'unpublish_entry',
    title: 'Withdraw entry from the release',
    description:
      'Owner action. Withdraws an entry from the release: its status becomes draft and the approved version is dropped. The draft is kept. The live site stops showing it at the next go live.',
    inputSchema: z.object({ id: idSchema('entry') }),
    access: 'owner',
    deniedMessage: OWNER_ONLY,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      const entry = await loadEntryInSite(actor, input.id)
      await unpublishEntry(entry.id, actor.userId)
      return formatStoredEntry(actor, entry.id)
    },
  })

  registry.add({
    name: 'archive_entry',
    title: 'Archive entry',
    description:
      'Owner action. Archives an entry so it is no longer used for new work; an owner can restore it in the CMS. The live site is updated at the next go live.',
    inputSchema: z.object({ id: idSchema('entry') }),
    access: 'owner',
    deniedMessage: OWNER_ONLY,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      const entry = await loadEntryInSite(actor, input.id)
      await archiveEntry(entry.id, actor.userId)
      return formatStoredEntry(actor, entry.id)
    },
  })

  registry.add({
    name: 'schedule_entry',
    title: 'Schedule entry',
    description: `${GO_LIVE_PERMISSION_NOTE} Schedules the entry to go live at a set time: status becomes scheduled, and the entry goes live at that time without a go_live call. publishAt is an ISO 8601 instant with an offset, e.g. "2026-10-20T09:00:00+02:00", and must be in the future. timezone is the IANA zone the owner wants shown, e.g. "Europe/Amsterdam". Pass expectedVersion (the version from get_entry) to schedule exactly the draft you reviewed; if the entry changed since, the call fails with a conflict and nothing is scheduled. Date fields in the content are not scheduling; use this tool to schedule.`,
    inputSchema: z.object({
      id: idSchema('entry'),
      expectedVersion,
      publishAt: z
        .string()
        .min(1)
        .max(100)
        .describe(
          'ISO 8601 date and time with offset, in the future, e.g. 2026-10-20T09:00:00+02:00.',
        ),
      timezone: z
        .string()
        .min(1)
        .max(100)
        .describe(
          'IANA time zone name, e.g. Europe/Amsterdam or America/New_York.',
        ),
    }),
    access: 'go-live',
    environments: PRODUCTION_ONLY,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    run: async (input, actor) => {
      const entry = await loadEntryInSite(actor, input.id)
      const scheduled = await scheduleEntry(
        entry.id,
        input.publishAt,
        input.timezone,
        actor.userId,
        input.expectedVersion,
      )
      return withImportWarnings(
        await formatStoredEntry(actor, entry.id),
        scheduled.importWarnings,
      )
    },
  })

  registry.add({
    name: 'cancel_schedule',
    title: 'Cancel schedule',
    description:
      'Owner action. Removes the scheduled go-live time from an entry. The draft and any live version are kept.',
    inputSchema: z.object({ id: idSchema('entry') }),
    access: 'owner',
    environments: PRODUCTION_ONLY,
    deniedMessage: OWNER_ONLY,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      const entry = await loadEntryInSite(actor, input.id)
      await cancelSchedule(entry.id, actor.userId)
      return formatStoredEntry(actor, entry.id)
    },
  })

  registry.add({
    name: 'delete_entry',
    title: 'Delete entry',
    description:
      'Owner action, destructive. Deletes the entry from the site. Only do this when the user has clearly asked for deletion. Prefer archive_entry when unsure.',
    inputSchema: z.object({ id: idSchema('entry') }),
    access: 'owner',
    deniedMessage: OWNER_ONLY,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      const entry = await loadEntryInSite(actor, input.id)
      await deleteEntry(entry.id, actor.userId)
      return { deleted: true, id: entry.id }
    },
  })

  registry.add({
    name: 'restore_revision',
    title: 'Restore revision',
    description:
      'Owner action. Copies an earlier revision back into the draft. It does not mark the entry ready and does not change the live site. Get revision ids from list_revisions. Pass expectedVersion from get_entry.',
    inputSchema: z.object({
      id: idSchema('entry'),
      revisionId: idSchema('revision'),
      expectedVersion,
    }),
    access: 'owner',
    deniedMessage: OWNER_ONLY,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    run: async (input, actor) => {
      const entry = await loadEntryInSite(actor, input.id)
      const restored = await restoreRevision(
        entry.id,
        input.revisionId,
        actor.userId,
        input.expectedVersion ?? entry.draftVersion,
      )
      return {
        ...(await formatStoredEntry(actor, entry.id)),
        skippedFields: restored.skippedFields,
      }
    },
  })
}
