import { z } from 'zod'

import {
  archiveEntry,
  cancelSchedule,
  deleteEntry,
  publishEntry,
  restoreRevision,
  scheduleEntry,
  unpublishEntry,
} from '#/server/content/entries'

import { formatStoredEntry } from './entries'
import { loadEntryInSite } from '../scope'
import { idSchema } from '../schemas'
import type { ToolRegistry } from '../tool-kit'

const OWNER_ONLY =
  'Only site owners can do this. Ask a site owner, or leave the entry as it is.'

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

export function registerEntryWorkflowTools(registry: ToolRegistry): void {
  registry.add({
    name: 'mark_ready',
    title: 'Mark entry ready',
    description:
      'Owner action. Marks an entry ready: approves its current draft for the next release. The entry status becomes ready. It does NOT change the live site: the approved version goes live with the next release (go_live, or an owner pressing Go live in the CMS). Required fields are checked here and the error names any that are missing. Check live and pendingRelease in the result.',
    inputSchema: z.object({ id: idSchema('entry') }),
    access: 'owner',
    deniedMessage:
      'Only site owners can mark entries ready. Ask an owner, or leave it as a draft.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      const entry = await loadEntryInSite(actor, input.id)
      await publishEntry(entry.id, actor.userId)
      return {
        message: APPROVED_MESSAGE,
        ...(await formatStoredEntry(actor, entry.id)),
      }
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
    description:
      'Requires permission to go live. Schedules the entry to go live at a set time: status becomes scheduled, and the entry goes live at that time without a go_live call. publishAt is an ISO 8601 instant with an offset, e.g. "2026-10-20T09:00:00+02:00", and must be in the future. timezone is the IANA zone the owner wants shown, e.g. "Europe/Amsterdam". Date fields in the content are not scheduling; use this tool to schedule.',
    inputSchema: z.object({
      id: idSchema('entry'),
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    run: async (input, actor) => {
      const entry = await loadEntryInSite(actor, input.id)
      await scheduleEntry(
        entry.id,
        input.publishAt,
        input.timezone,
        actor.userId,
      )
      return formatStoredEntry(actor, entry.id)
    },
  })

  registry.add({
    name: 'cancel_schedule',
    title: 'Cancel schedule',
    description:
      'Owner action. Removes the scheduled go-live time from an entry. The draft and any live version are kept.',
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
