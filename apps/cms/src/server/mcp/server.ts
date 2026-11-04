import { McpServer } from '@modelcontextprotocol/server'
import { z } from '#/lib/zod'

import { credentialPhrase } from './guard'
import type { McpActor } from './keys'
import {
  CODE_BLOCK_INSTRUCTION,
  RICH_TEXT_MARKDOWN_INSTRUCTION,
} from './rich-text-guide'
import { IMAGE_UPLOAD_INSTRUCTION } from './image-guide'
import { mcpResourceUrl } from './oauth-resource'
import type { McpSiteContext } from './site-context'
import { ToolRegistry } from './tool-kit'
import { SITE_TOOLS } from './tool-catalog'

export const MCP_SERVER_NAME = 'areca-cms'
export const MCP_SERVER_VERSION = '1.0.0'

const PRODUCTION_CONTEXT: McpSiteContext = {
  environment: 'production',
  productionSlug: null,
  devSlug: null,
}

/** What the caller may do, in the words the CMS uses. Drives the instructions. */
function roleInstruction(
  actor: Pick<McpActor, 'role' | 'allowGoLive' | 'credential'>,
  site: McpSiteContext,
): string[] {
  if (actor.role === 'editor') {
    return [
      'You can create and edit drafts, upload images and edit alt text. You cannot mark entries ready or go live.',
      'When the user asks you to approve or publish an entry, explain that a site owner must mark it ready in the CMS. Do not try other tools to get around this.',
    ]
  }
  const lines = [
    'mark_ready marks an entry ready: it approves the entry for the next release. Ready does not change the live site until the next go live.',
  ]
  // A development environment has no releases, so go_live and its neighbours are not listed there.
  if (site.environment === 'production') {
    if (actor.allowGoLive) {
      lines.push(
        'go_live puts the release live (builds the ready changes and deploys them). Only call it when the user asks.',
      )
    } else {
      const fix =
        actor.credential === 'oauth'
          ? ', or that the app can be reconnected from Connect AI with "Allow going live" ticked'
          : ''
      lines.push(
        `Going live is not enabled for ${credentialPhrase(actor.credential)}. When the user asks to go live, explain that a site owner presses Go live in the CMS${fix}.`,
      )
    }
  }
  if (actor.role === 'agency') {
    lines.push(
      'You can also change collection schemas (upsert_collection, delete_collection) and site content sections (upsert_global, delete_global). If the site syncs its schema from code, prefer changing areca.config.ts. set_site_languages changes the site languages, and set_publishing_mode switches the site between demo and production publishing.',
    )
  }
  return [...lines, ...environmentInstruction(actor, site)]
}

/**
 * Development environment facts for the model. Only agency admins hear about
 * the development environment of a production site (Decision 3).
 */
function environmentInstruction(
  actor: Pick<McpActor, 'role'>,
  site: McpSiteContext,
): string[] {
  if (site.environment === 'development') {
    return [
      `This is a development environment for the production site "${site.productionSlug ?? 'unknown'}". Changes made here stay here until they are pushed to production.`,
      'A pull with this key reads the ready content of this environment now, without a release.',
      'To send changes to production, call push_to_production with dryRun (the default) first and show the list to the user. Apply only after the user approves, passing the planHash from that dry run. copy_entry_to_production copies one entry as a draft.',
    ]
  }
  if (site.devSlug && actor.role === 'agency') {
    return [
      `This site has a development environment (${mcpResourceUrl(site.devSlug)}). Make changes there, then push.`,
    ]
  }
  return []
}

/** Read by the model once, at connection time. Keep it short and specific. */
export function serverInstructions(
  actor: Pick<McpActor, 'siteName' | 'role' | 'allowGoLive' | 'credential'>,
  site: McpSiteContext = PRODUCTION_CONTEXT,
): string {
  return [
    `This server edits one website: "${actor.siteName}". Every tool acts only on that site.`,
    'Before writing: call get_site_info (your role, what you cannot do, and the collections), then get_collection_schema for the collection you need. The schema gives the exact field formats and an example payload.',
    'Entry status: draft (not approved), ready (approved for the next release; status "ready" is not the same as live), scheduled, archived. Check the live and pendingRelease flags to know what visitors see.',
    'Site content (globals) is a single section of values, such as company info or the home page. Read it with get_global and change it with update_global; it is not a collection, so create_entry and list_entries do not apply. Its id works with mark_ready and the other workflow tools.',
    RICH_TEXT_MARKDOWN_INSTRUCTION,
    CODE_BLOCK_INSTRUCTION,
    'Always fill SEO for new entries: seo.title (about 50-60 characters), seo.description (140-160 characters), seo.focusKeyphrase, seo.summary (2-3 sentences), seo.keyTakeaways (3-5), and seo.faq only when the body really answers questions.',
    IMAGE_UPLOAD_INSTRUCTION,
    'Drafts are safe. Nothing you write changes the live site until it is approved and a go live happens.',
    ...roleInstruction(actor, site),
    'Respect the caller role: tools you cannot use are not listed. If an action is refused, explain the reason to the user and say who can do it.',
    'When an update fails with a version conflict, call get_entry again and reapply the change to the current version.',
  ].join('\n')
}

const WRITE_POST_TEXT = (
  collection: string,
  topic: string,
  canApprove: boolean,
) =>
  [
    `Write a complete "${collection}" entry about: ${topic}.`,
    '1. Call get_site_info, then get_collection_schema for "' +
      collection +
      '". Note the required fields, the slug field and the formats.',
    '2. Draft the content in Markdown: an intro that answers the main question, clear ## sections, a short conclusion. Use real facts only; ask the user if you lack them.',
    '3. Fill SEO: title (50-60 characters), description (140-160 characters), focusKeyphrase, summary, keyTakeaways, and faq if the post answers questions.',
    '4. If you need an image, use list_assets, upload_asset_from_url (public link) or create_asset_upload (local files and chat attachments), and reference it with its assetId. Always write alt text.',
    '5. create_entry with the fields (including the slug) and seo. The entry is a draft. Share the returned preview URL with the user and ask for feedback.',
    canApprove
      ? '6. Only call mark_ready (approve for the next release) or go_live (put the release live) when the user asks you to.'
      : '6. You cannot mark the entry ready. When the user wants it approved, tell them a site owner must mark it ready in the CMS.',
  ].join('\n')

/** Registers the per-site tools this actor may use on this site's environment. */
export function registerPerSiteTools(
  server: Pick<McpServer, 'registerTool'>,
  actor: McpActor,
  site: McpSiteContext,
): void {
  const registry = new ToolRegistry(server, actor, site)
  for (const entry of SITE_TOOLS) registry.add(entry)
}

export function createArecaMcpServer(
  actor: McpActor,
  site: McpSiteContext = PRODUCTION_CONTEXT,
): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: serverInstructions(actor, site) },
  )

  registerPerSiteTools(server, actor, site)

  server.registerPrompt(
    'write_post',
    {
      title: 'Write a post',
      description:
        'Walks the model through writing and saving one complete entry.',
      argsSchema: {
        collection: z.string().min(1).describe('Collection key, e.g. "posts".'),
        topic: z.string().min(1).describe('What the entry is about.'),
      },
    },
    ({ collection, topic }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: WRITE_POST_TEXT(collection, topic, actor.role !== 'editor'),
          },
        },
      ],
    }),
  )

  return server
}
