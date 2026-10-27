import { randomBytes, randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

import { db } from '#/db'
import {
  collection,
  entry,
  entryRevision,
  environmentPush,
  site,
} from '#/db/schema'
import type { EntryData, EntryOriginBaseline } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { lockOrganizationForMutation } from '#/server/admin/organization-lock'
import { ConflictError, NotFoundError } from '#/server/content/errors'
import { generateSiteToken } from '#/server/content/site-auth'
import { isDevSite } from '#/server/security/site-visibility'

import { schemaSnapshot } from './schema-snapshot'
import { remapReferences } from './references'
import { lockProductionSite } from './lock'
import { DEV_SLUG_ATTEMPTS, devSlugCandidates, pickDevSlug } from './slug'
import { lockProductionRow } from './rows'
import type { DevEnvActor, SiteRow, Tx } from './rows'

/** Preview URL of a new dev env: the agency's local site (Decision 10). */
export const DEV_PREVIEW_URL = 'http://localhost:3000'

/** Rows per insert, to stay under the driver's bind-parameter limit. */
const INSERT_CHUNK = 500

export type DevEnvCounts = {
  collections: number
  sections: number
  entries: number
}

/**
 * Fork steps 4 to 6, shared by fork and reset (docs/design/dev-environments.md,
 * "Fork"). Copies every collection and section (enabled or not) and the ready
 * content of production; then records the schema baseline and the fork time.
 * Languages and the AI prompt are refreshed from production too. Expects the
 * dev row to exist and the dev content to be empty.
 */
export async function copyProductionIntoDev(
  tx: Tx,
  prod: SiteRow,
  dev: SiteRow,
  actorId: string,
): Promise<DevEnvCounts> {
  const now = new Date()
  const prodCollections = await tx
    .select()
    .from(collection)
    .where(eq(collection.siteId, prod.id))

  const devCollectionIds = new Map<string, string>()
  const collectionRows = prodCollections.map((col) => {
    const id = randomUUID()
    devCollectionIds.set(col.id, id)
    return {
      id,
      siteId: dev.id,
      key: col.key,
      label: col.label,
      routePattern: col.routePattern,
      fields: col.fields,
      enabled: col.enabled,
      kind: col.kind,
      seoEnabled: col.seoEnabled,
      previewPath: col.previewPath,
      requiredLanguages: col.requiredLanguages,
      localizedRoutes: col.localizedRoutes,
    }
  })
  await insertChunked(collectionRows, (rows) =>
    tx.insert(collection).values(rows),
  )

  const sectionCollectionIds = new Set(
    prodCollections.filter((col) => col.kind === 'global').map((col) => col.id),
  )
  const prodEntries = await tx
    .select()
    .from(entry)
    .where(eq(entry.siteId, prod.id))

  // Which production entries are copied, and the dev id each one gets. Done
  // first, so references can be re-pointed at dev ids before anything is written.
  const copies: {
    row: (typeof prodEntries)[number]
    id: string
    collectionId: string
    isSection: boolean
  }[] = []
  let collectionEntries = 0
  for (const row of prodEntries) {
    const isSection = sectionCollectionIds.has(row.collectionId)
    // Collection entries: skip archived ones and any never marked ready.
    // Sections are always copied, empty or not.
    if (
      !isSection &&
      (row.status === 'archived' || row.publishedData == null)
    ) {
      continue
    }
    const collectionId = devCollectionIds.get(row.collectionId)
    if (!collectionId) continue
    copies.push({ row, id: randomUUID(), collectionId, isSection })
    if (!isSection) collectionEntries += 1
  }

  // A reference holds the target's id. A copied target is re-pointed at its
  // dev id; a target that was not copied keeps its production id, which the
  // push passes through unchanged (docs/design/dev-environments.md, "Reference
  // mapping").
  const devIdByOrigin = new Map(copies.map((copy) => [copy.row.id, copy.id]))
  const lookup = (productionId: string) =>
    devIdByOrigin.get(productionId) ?? productionId
  const fieldsByCollection = new Map(
    prodCollections.map((col) => [col.id, col.fields]),
  )

  const entryRows: (typeof entry.$inferInsert)[] = []
  const revisionRows: (typeof entryRevision.$inferInsert)[] = []
  for (const { row, id, collectionId } of copies) {
    const ready = row.publishedData != null
    const slug = row.publishedSlug ?? row.slug
    const publishedData =
      row.publishedData == null
        ? null
        : remapReferences(
            row.publishedData,
            fieldsByCollection.get(row.collectionId) ?? [],
            lookup,
          ).data
    // Unfinished production drafts are not copied (Decision 9): a section
    // without a ready version starts empty.
    const draftData: EntryData = publishedData ?? {}
    const publishedSlug = ready ? slug : null
    const originBaseline: EntryOriginBaseline = {
      slug,
      data: draftData,
      publishedSlug,
      publishedData,
      status: ready ? 'published' : 'draft',
    }
    entryRows.push({
      id,
      siteId: dev.id,
      collectionId,
      slug,
      status: ready ? 'published' : 'draft',
      draftData,
      publishedData,
      publishedSlug,
      publishedAt: ready ? now : null,
      draftVersion: 1,
      contentVersion: 1,
      originEntryId: row.id,
      originBaseline,
      originContentVersion: row.contentVersion,
    })
    revisionRows.push({
      entryId: id,
      data: draftData,
      createdBy: actorId,
      note: 'fork',
      kind: 'milestone',
    })
  }
  await insertChunked(entryRows, (rows) => tx.insert(entry).values(rows))
  await insertChunked(revisionRows, (rows) =>
    tx.insert(entryRevision).values(rows),
  )

  await tx
    .update(site)
    .set({
      languages: prod.languages,
      aiPrompt: prod.aiPrompt,
      schemaBaseline: await schemaSnapshot(tx, prod.id),
      lastForkedAt: now,
      updatedAt: now,
    })
    .where(eq(site.id, dev.id))

  return {
    collections: prodCollections.filter((col) => col.kind === 'collection')
      .length,
    sections: sectionCollectionIds.size,
    entries: collectionEntries,
  }
}

async function insertChunked<T>(
  rows: T[],
  insert: (chunk: T[]) => Promise<unknown>,
) {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    await insert(rows.slice(start, start + INSERT_CHUNK))
  }
}

/**
 * Creates the development environment of a production site: a linked site
 * with the production schema and ready content. Agency admins only, no
 * step-up (Decision 6). Tokens are returned once, as on site creation.
 */
export async function forkDevEnvironment(
  actor: DevEnvActor,
  productionSiteId: string,
) {
  const probe = (
    await db
      .select({ organizationId: site.organizationId })
      .from(site)
      .where(eq(site.id, productionSiteId))
      .limit(1)
  ).at(0)
  if (!probe) throw new NotFoundError(m.server_site_not_found())

  return db.transaction(async (tx) => {
    await lockOrganizationForMutation(tx, probe.organizationId, {
      mode: 'no-key-update',
    })
    const prod = await lockProductionRow(tx, productionSiteId)
    if (isDevSite(prod)) {
      throw new ConflictError(m.server_dev_env_production_only())
    }
    await lockProductionSite(tx, prod.id)

    const existing = (
      await tx
        .select({ id: site.id })
        .from(site)
        .where(eq(site.parentSiteId, prod.id))
        .limit(1)
    ).at(0)
    if (existing) throw new ConflictError(m.server_dev_env_exists())

    const taken = await tx
      .select({ slug: site.slug })
      .from(site)
      .where(
        inArray(site.slug, devSlugCandidates(prod.slug, DEV_SLUG_ATTEMPTS)),
      )
    const takenSlugs = new Set(taken.map((row) => row.slug))
    const devSlug = pickDevSlug(prod.slug, (candidate) =>
      takenSlugs.has(candidate),
    )
    if (!devSlug) {
      throw new ConflictError(
        m.server_dev_env_slug_exhausted({ slug: prod.slug }),
      )
    }

    const token = generateSiteToken()
    const schemaToken = generateSiteToken()
    const previewSecret = randomBytes(32).toString('hex')
    const dev = (
      await tx
        .insert(site)
        .values({
          organizationId: prod.organizationId,
          name: `${prod.name} (dev)`,
          slug: devSlug,
          tokenHash: token.hash,
          schemaTokenHash: schemaToken.hash,
          productionUrl: DEV_PREVIEW_URL,
          previewSecret,
          publishingMode: 'demo',
          deploymentTarget: null,
          environment: 'development',
          parentSiteId: prod.id,
        })
        .returning()
    ).at(0)
    if (!dev) throw new Error(m.server_failed_to_create_site())

    const counts = await copyProductionIntoDev(tx, prod, dev, actor.id)
    await tx.insert(environmentPush).values({
      devSiteId: dev.id,
      productionSiteId: prod.id,
      kind: 'fork',
      actorId: actor.id,
      counts,
      items: [],
    })
    await audit(
      {
        organizationId: prod.organizationId,
        siteId: prod.id,
        actorId: actor.id,
        action: 'dev_env.fork',
        targetType: 'site',
        targetId: dev.id,
        meta: { slug: devSlug, ...counts },
      },
      tx,
    )

    return {
      id: dev.id,
      slug: devSlug,
      counts,
      token: token.token,
      schemaToken: schemaToken.token,
      previewSecret,
    }
  })
}
