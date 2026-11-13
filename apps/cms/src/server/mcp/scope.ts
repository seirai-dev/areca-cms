import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { site } from '#/db/schema'
import { getCollection, listCollections } from '#/server/content/collections'
import { getEntry } from '#/server/content/entries'
import {
  getGlobal,
  isHiddenSectionEntry,
  listGlobals,
} from '#/server/content/globals'
import { getBuildJob, getPublication } from '#/server/publishing/publications'

import { McpNotFoundError } from './errors'
import type { McpActor } from './keys'
import { siteCoreColumns } from '#/server/content/site-core'

/**
 * Tenancy checks for every id an agent sends. Services do not check the site,
 * so each lookup here compares the row's site with the key's site and answers
 * "not found" for other tenants' rows, the same as for missing ids.
 */

/**
 * True when the row exists and belongs to the site. Takes a nullable row so a
 * missing lookup is handled here rather than assumed away by the caller.
 */
function belongsTo<T extends { siteId: string }>(
  row: T | null | undefined,
  siteId: string,
): row is T {
  return row !== null && row !== undefined && row.siteId === siteId
}

export async function loadSiteRow(actor: McpActor) {
  const row = (
    await db
      .select(siteCoreColumns)
      .from(site)
      .where(eq(site.id, actor.siteId))
      .limit(1)
  ).at(0)
  if (!row) throw new McpNotFoundError('This site no longer exists.')
  return row
}

export async function loadEntryInSite(actor: McpActor, id: string) {
  const row = await getEntry(id)
  if (
    !belongsTo(row, actor.siteId) ||
    (await isHiddenSectionEntry(row.collectionId, actor.role === 'agency'))
  ) {
    throw new McpNotFoundError(
      `No entry with id "${id}" on this site. Use list_entries to find valid ids.`,
    )
  }
  return row
}

export async function loadCollectionInSite(actor: McpActor, key: string) {
  const row = await getCollection(actor.siteId, key)
  if (!row) {
    const keys = (await listCollections(actor.siteId)).map((col) => col.key)
    // Same visibility as loadGlobalInSite: a disabled section is unknown to
    // editors and owners, so the hint must not reveal it to them.
    const global = await getGlobal(actor.siteId, key)
    const isGlobal =
      global !== null && (global.enabled || actor.role === 'agency')
    const hint = isGlobal
      ? ` "${key}" is site content, not a collection: use get_global and update_global.`
      : ''
    throw new McpNotFoundError(
      `No collection "${key}" on this site.${hint} Valid collections: ${keys.join(', ') || '(none)'}. Call get_site_info to see them.`,
    )
  }
  return row
}

/**
 * A site content section by key. Editors and owners only reach enabled
 * sections; agency admins also reach disabled ones, as in the CMS.
 */
export async function loadGlobalInSite(actor: McpActor, key: string) {
  const row = await getGlobal(actor.siteId, key)
  if (row && (row.enabled || actor.role === 'agency')) return row
  const keys = (
    await listGlobals(actor.siteId, { enabledOnly: actor.role !== 'agency' })
  ).map((item) => item.key)
  throw new McpNotFoundError(
    `No site content "${key}" on this site. Valid site content: ${keys.join(', ') || '(none)'}. Call get_site_info to see them.`,
  )
}

/**
 * The schema behind an entry's collection key: a collection or a site content
 * section. `kind` says which, so callers shape the answer for each.
 */
export async function loadContentInSite(actor: McpActor, key: string) {
  if ((await getGlobal(actor.siteId, key)) !== null) {
    return { ...(await loadGlobalInSite(actor, key)), kind: 'global' as const }
  }
  return {
    ...(await loadCollectionInSite(actor, key)),
    kind: 'collection' as const,
  }
}

export async function loadBuildJobInSite(actor: McpActor, jobId: string) {
  const job = await getBuildJob(jobId)
  if (!belongsTo(job, actor.siteId)) {
    throw new McpNotFoundError(
      `No build job with id "${jobId}" on this site. Call get_release_status to find the current job.`,
    )
  }
  return job
}

export async function loadPublicationInSite(actor: McpActor, id: string) {
  const row = await getPublication(id)
  if (!belongsTo(row, actor.siteId)) {
    throw new McpNotFoundError(
      `No publication with id "${id}" on this site. Call list_publications to find valid ids.`,
    )
  }
  return row
}
