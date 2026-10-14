import { z } from 'zod'

import { listCollections } from '#/server/content/collections'
import { listGlobals } from '#/server/content/globals'

import { credentialPhrase } from '../guard'
import type { ToolRegistry } from '../tool-kit'
import { loadCollectionInSite, loadSiteRow } from '../scope'
import type { McpActor } from '../keys'
import {
  exampleFields,
  describeField,
  DATES_NOTE,
  EXAMPLE_SEO,
  SEO_GUIDE,
  STATUS_GUIDE,
} from '../schema-docs'

/**
 * What this key cannot do, as sentences a person can act on. Editors and keys
 * without go-live see these; the tools themselves are not listed to them.
 */
export function cannotDoFor(actor: McpActor): string[] {
  const out: string[] = []
  if (actor.role === 'editor') {
    out.push(
      'Mark entries ready, schedule, unpublish, archive, delete, restore revisions, or delete files: ask a site owner.',
    )
  }
  if (!actor.allowGoLive) {
    out.push(
      actor.credential === 'oauth'
        ? `Go live or schedule: going live is not enabled for ${credentialPhrase(actor.credential)}. A site owner presses Go live in the CMS, or the app can be reconnected from Connect AI with "Allow going live" ticked.`
        : `Go live or schedule: going live is not enabled for ${credentialPhrase(actor.credential)}. A site owner presses Go live in the CMS.`,
    )
  }
  if (actor.role !== 'agency') {
    out.push(
      'Change collection schemas (add, edit or delete collections): only agency admins can, so ask one.',
    )
  }
  return out
}

function writingGuide(actor: McpActor): string {
  const approval =
    actor.role === 'editor'
      ? 'You cannot mark entries ready. When the user asks for approval or publishing, explain that a site owner must mark it ready in the CMS.'
      : 'mark_ready marks an entry ready (approves it for the next release). It does not change the live site.'
  return [
    'Workflow: 1) get_collection_schema for the collection you need. 2) create_entry with fields and seo (rich text as Markdown). 3) get_preview_url to check it. 4) update_entry to revise (pass the version from get_entry as expectedVersion).',
    'Site content (globals) is not a collection: read a section with get_global and change it with update_global (pass expectedVersion from get_global). Its id works with mark_ready and the other workflow tools.',
    'Images: upload_asset_from_url with a public image URL, then use the returned assetId in image fields, seo.ogImage, or ![alt](asset:<assetId>) in Markdown. Always give alt text.',
    'Drafts are safe. ' +
      approval +
      ' go_live puts the release live, and only when the user asks.',
    STATUS_GUIDE,
    DATES_NOTE,
    SEO_GUIDE,
  ].join('\n')
}

export function registerSiteTools(registry: ToolRegistry): void {
  registry.add({
    name: 'get_site_info',
    title: 'Get site info',
    description:
      'Call this first. Returns the site this AI connection is for (name, slug, production URL, publishing mode), your role and what you may do, every collection with its route and whether it is enabled, the site content sections (globals) with their keys, and a short guide for writing content. Read-only.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (_input, actor) => {
      const siteRow = await loadSiteRow(actor)
      const collections = await listCollections(actor.siteId)
      const globals = await listGlobals(actor.siteId, {
        enabledOnly: actor.role !== 'agency',
      })
      const isOwner = actor.role !== 'editor'
      return {
        cannotDo: cannotDoFor(actor),
        site: {
          id: siteRow.id,
          name: siteRow.name,
          slug: siteRow.slug,
          productionUrl: siteRow.productionUrl,
          publishingMode: siteRow.publishingMode,
        },
        you: {
          name: actor.userName,
          role: actor.role,
          keyName: actor.keyName,
          capabilities: {
            readAndWriteDrafts: true,
            uploadAndEditAssets: true,
            previewEntries: true,
            markReady: isOwner,
            unpublishArchiveScheduleDelete: isOwner && actor.allowGoLive,
            unpublishArchiveDelete: isOwner,
            schedule: actor.allowGoLive,
            restoreRevisions: isOwner,
            deleteAssets: isOwner,
            goLive: actor.allowGoLive,
            changeCollectionSchema: actor.role === 'agency',
            changeSiteContentStructure: actor.role === 'agency',
          },
        },
        collections: collections.map((col) => ({
          key: col.key,
          label: col.label,
          route: col.routePattern,
          enabled: col.enabled,
          fieldCount: col.fields.length,
        })),
        globals: globals.map((global) => ({
          key: global.key,
          label: global.label,
          enabled: global.enabled,
          fieldCount: global.fields.length,
          seo: global.seoEnabled,
          previewPath: global.previewPath,
        })),
        guide: writingGuide(actor),
      }
    },
  })

  registry.add({
    name: 'get_collection_schema',
    title: 'Get collection schema',
    description:
      'Describes one collection: each field with its key, type, required flag, allowed options or referenced collection, the exact format to write, and a complete example "fields" and "seo" payload to copy and adapt. Call this before create_entry or update_entry.',
    inputSchema: z.object({
      collection: z
        .string()
        .min(1)
        .describe(
          'Collection key, e.g. "posts". See get_site_info for the keys.',
        ),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (input, actor) => {
      const col = await loadCollectionInSite(actor, input.collection)
      return {
        collection: col.key,
        label: col.label,
        route: col.routePattern,
        enabled: col.enabled,
        fields: col.fields.map(describeField),
        example: {
          fields: exampleFields(col.fields),
          seo: EXAMPLE_SEO,
        },
        seo: {
          keys: 'Object with optional keys: title, description, focusKeyphrase, canonicalUrl, noindex, nofollow, ogTitle, ogDescription, ogImage, twitterCard, schemaType, summary, keyTakeaways, faq, about, author, jsonLd. To clear a key on update: empty string for text, false for noindex/nofollow, empty array for lists.',
          guide: SEO_GUIDE,
        },
        notes: [
          'Create with create_entry({collection, fields, seo}). Update with update_entry({id, fields, seo}); only the keys you send change.',
          'Dates: date is YYYY-MM-DD; datetime is ISO 8601 with an offset.',
          DATES_NOTE,
          'Drafts may be incomplete. Required fields are enforced when an owner marks the entry ready.',
          'The slug field (type slug) must be lowercase letters, numbers and dashes, and unique within the collection.',
          STATUS_GUIDE,
        ],
      }
    },
  })
}
