import { z } from '#/lib/zod'

import { isTranslatable } from '#/lib/content-locale'
import type { site } from '#/db/schema'
import { listCollections } from '#/server/content/collections'
import { listGlobals } from '#/server/content/globals'
import { deploymentBlockers } from '#/server/publishing/publications'
import {
  languageName,
  loadSiteLanguages,
} from '#/server/content/locale-validation'
import type { Field, SiteLanguages } from '#/lib/types'

import { credentialPhrase } from '../guard'
import { IMAGE_UPLOAD_SHORT } from '../image-guide'
import { mcpResourceUrl } from '../oauth-resource'
import type { ToolCollector } from '../tool-kit'
import type { McpSiteContext } from '../site-context'
import { loadCollectionInSite, loadSiteRow } from '../scope'
import type { McpActor } from '../keys'
import {
  exampleFields,
  describeField,
  DATES_NOTE,
  EXAMPLE_SEO,
  SEO_GUIDE,
  STATUS_GUIDE,
  translationExample,
} from '../schema-docs'

/**
 * What this key cannot do, as sentences a person can act on. Editors and keys
 * without go-live see these; the tools themselves are not listed to them.
 */
export function cannotDoFor(
  actor: McpActor,
  environment: McpSiteContext['environment'] = 'production',
): string[] {
  const out: string[] = []
  if (actor.role === 'editor') {
    out.push(
      'Mark entries ready, schedule, unpublish, archive, delete, restore revisions, or delete files: ask a site owner.',
    )
  }
  if (environment === 'development') {
    // A development environment has no releases, so there is nothing to go live here.
    out.push(
      'Go live, schedule, roll back or cancel builds: this is a development environment, which has no releases. Push changes to production with push_to_production, and a site owner goes live on the production site in the CMS.',
    )
  } else if (!actor.allowGoLive) {
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

/**
 * True when the site has the deployment target a production go live needs.
 * Reuses deploymentBlockers, which skips the check for demo sites, so the
 * site is checked as production.
 */
export function isDeploymentConfigured(row: typeof site.$inferSelect): boolean {
  return (
    deploymentBlockers({ ...row, publishingMode: 'production' }).length === 0
  )
}

/** The site's languages as agents read them: codes, English names, main. */
export function languageSummary(languages: SiteLanguages) {
  return {
    main: languages.main,
    all: languages.all,
    names: Object.fromEntries(
      languages.all.map((code) => [code, languageName(code)]),
    ),
  }
}

const LINKS_GUIDE =
  'Links: to a page of this site, use its site path from get_site_info, such as /coffees/slug, built from the collection route and the entry slug. To a section of a page, add #anchor, such as /coffees/slug#origin. Never write a full URL of this site. Other sites use full https:// links.'

const LANGUAGES_GUIDE = [
  'Languages: this site publishes in several languages. The main language is the fallback. To write a translation, call update_entry (or update_global) once per language with locale set to that language: fields, seo and slug apply to that language. Shared fields (translatable false) change in every language, and the response lists them in sharedFieldsUpdated.',
  'Check the other languages with get_entry: translations shows, for each language, whether it is complete and which required fields are missing. Ready is blocked until every required language is complete.',
].join(' ')

function writingGuide(
  actor: McpActor,
  languages: SiteLanguages | null,
  environment: McpSiteContext['environment'],
): string {
  const approval =
    actor.role === 'editor'
      ? 'You cannot mark entries ready. When the user asks for approval or publishing, explain that a site owner must mark it ready in the CMS.'
      : 'mark_ready marks an entry ready (approves it for the next release). It does not change the live site.'
  const release =
    environment === 'development'
      ? ' There is no go_live on a development environment: push changes to production with push_to_production, after a dry run the user approves.'
      : ' go_live puts the release live, and only when the user asks.'
  return [
    'Workflow: 1) get_collection_schema for the collection you need. 2) create_entry with fields and seo (rich text as Markdown). 3) get_preview_url to check it. 4) update_entry to revise (pass the version from get_entry as expectedVersion).',
    'Site content (globals) is not a collection: read a section with get_global and change it with update_global (pass expectedVersion from get_global). Its id works with mark_ready and the other workflow tools.',
    IMAGE_UPLOAD_SHORT,
    'Drafts are safe. ' + approval + release,
    STATUS_GUIDE,
    LINKS_GUIDE,
    DATES_NOTE,
    SEO_GUIDE,
    ...(languages ? [LANGUAGES_GUIDE] : []),
  ].join('\n')
}

export function registerSiteTools(registry: ToolCollector): void {
  registry.add({
    name: 'get_site_info',
    title: 'Get site info',
    description:
      'Call this first. Returns the site this AI connection is for (name, slug, production URL, publishing mode, whether a deployment target is configured, and its environment: production or development; a development environment also names its production slug, and a production site with a development environment names it for agency admins), your role and what you may do, every collection with its route and whether it is enabled, the site content sections (globals) with their keys, and a short guide for writing content. Read-only.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (_input, actor, site) => {
      const siteRow = await loadSiteRow(actor)
      const languages = await loadSiteLanguages(actor.siteId)
      const collections = await listCollections(actor.siteId)
      const globals = await listGlobals(actor.siteId, {
        enabledOnly: actor.role !== 'agency',
      })
      const isOwner = actor.role !== 'editor'
      // Development environments have no releases, so going live and scheduling never apply there.
      const canGoLive = actor.allowGoLive && site.environment === 'production'
      return {
        cannotDo: cannotDoFor(actor, site.environment),
        ...(languages ? { languages: languageSummary(languages) } : {}),
        site: {
          id: siteRow.id,
          name: siteRow.name,
          slug: siteRow.slug,
          productionUrl: siteRow.productionUrl,
          publishingMode: siteRow.publishingMode,
          deploymentConfigured: isDeploymentConfigured(siteRow),
          environment: site.environment,
          ...(site.environment === 'development'
            ? { productionSlug: site.productionSlug }
            : {}),
          ...(site.devSlug && actor.role === 'agency'
            ? {
                devEnvironment: {
                  slug: site.devSlug,
                  connectorUrl: mcpResourceUrl(site.devSlug),
                },
              }
            : {}),
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
            unpublishArchiveScheduleDelete: isOwner && canGoLive,
            unpublishArchiveDelete: isOwner,
            schedule: canGoLive,
            restoreRevisions: isOwner,
            deleteAssets: isOwner,
            goLive: canGoLive,
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
          ...(languages
            ? languageInfo(
                languages,
                col.requiredLanguages,
                col.fields,
                col.localizedRoutes,
              )
            : {}),
        })),
        globals: globals.map((global) => ({
          key: global.key,
          label: global.label,
          enabled: global.enabled,
          fieldCount: global.fields.length,
          seo: global.seoEnabled,
          previewPath: global.previewPath,
          ...(languages
            ? languageInfo(languages, global.requiredLanguages, global.fields)
            : {}),
        })),
        guide: writingGuide(actor, languages, site.environment),
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
      const languages = await loadSiteLanguages(actor.siteId)
      return {
        collection: col.key,
        label: col.label,
        route: col.routePattern,
        enabled: col.enabled,
        fields: col.fields.map((field) =>
          describeField(
            field,
            languages ? { translatable: isTranslatable(field) } : {},
          ),
        ),
        example: {
          fields: exampleFields(col.fields),
          seo: EXAMPLE_SEO,
        },
        ...(languages
          ? {
              translation: translationExample({
                ...languages,
                fields: col.fields,
                seoEnabled: true,
                tool: 'update_entry',
                target: { id: '<entryId from list_entries>' },
              }),
            }
          : {}),
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

/**
 * Per-collection or section language facts for get_site_info: the languages
 * it must be complete in, the fields stored per language, and (collections
 * only) the per-language route patterns.
 */
function languageInfo(
  languages: SiteLanguages,
  requiredLanguages: string[],
  fields: Field[],
  localizedRoutes?: Record<string, string> | null,
) {
  const required = requiredLanguages.filter((code) =>
    languages.all.includes(code),
  )
  return {
    requiredLanguages: required,
    translatableFields: fields.filter(isTranslatable).map((field) => field.key),
    ...(localizedRoutes && Object.keys(localizedRoutes).length > 0
      ? { routes: localizedRoutes }
      : {}),
  }
}
