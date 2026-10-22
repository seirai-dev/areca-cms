import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { credentialPhrase } from './guard'
import type { McpActor } from './keys'
import { ToolRegistry } from './tool-kit'
import { registerAssetTools } from './tools/assets'
import { registerEntryTools } from './tools/entries'
import { registerEntryWorkflowTools } from './tools/entry-workflow'
import { registerLanguageTools } from './tools/languages'
import { registerGlobalTools } from './tools/globals'
import { registerPublishingTools } from './tools/publishing'
import { registerSchemaTools } from './tools/schema'
import { registerSiteTools } from './tools/site'

export const MCP_SERVER_NAME = 'areca-cms'
export const MCP_SERVER_VERSION = '1.0.0'

/** What the caller may do, in the words the CMS uses. Drives the instructions. */
function roleInstruction(
  actor: Pick<McpActor, 'role' | 'allowGoLive' | 'credential'>,
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
  if (actor.role === 'agency') {
    lines.push(
      'You can also change collection schemas (upsert_collection, delete_collection) and site content sections (upsert_global, delete_global). If the site syncs its schema from code, prefer changing areca.config.ts. set_site_languages changes the site languages.',
    )
  }
  return lines
}

/** Read by the model once, at connection time. Keep it short and specific. */
export function serverInstructions(
  actor: Pick<McpActor, 'siteName' | 'role' | 'allowGoLive' | 'credential'>,
): string {
  return [
    `This server edits one website: "${actor.siteName}". Every tool acts only on that site.`,
    'Before writing: call get_site_info (your role, what you cannot do, and the collections), then get_collection_schema for the collection you need. The schema gives the exact field formats and an example payload.',
    'Entry status: draft (not approved), ready (approved for the next release; status "ready" is not the same as live), scheduled, archived. Check the live and pendingRelease flags to know what visitors see.',
    'Site content (globals) is a single section of values, such as company info or the home page. Read it with get_global and change it with update_global; it is not a collection, so create_entry and list_entries do not apply. Its id works with mark_ready and the other workflow tools.',
    'Write rich text fields as Markdown (headings ##, lists, links, ![alt](asset:<assetId>) images). Do not send HTML.',
    'Always fill SEO for new entries: seo.title (about 50-60 characters), seo.description (140-160 characters), seo.focusKeyphrase, seo.summary (2-3 sentences), seo.keyTakeaways (3-5), and seo.faq only when the body really answers questions.',
    "Images: upload_asset_from_url with a direct link to the image file, then use the returned assetId in image fields, seo.ogImage and ![alt](asset:<assetId>). Always give alt text. If an upload fails, do not guess other URLs: ask the user for a working link or continue without the image. An external ![alt](https://...) image in rich text is copied into the media library when the entry is saved; any that could not be copied are listed in the result's warnings.",
    'Drafts are safe. Nothing you write changes the live site until it is approved and a go live happens.',
    ...roleInstruction(actor),
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
    '4. If you need an image, use upload_asset_from_url or list_assets, and reference it with its assetId. Always write alt text.',
    '5. create_entry with the fields (including the slug) and seo. The entry is a draft. Share the returned preview URL with the user and ask for feedback.',
    canApprove
      ? '6. Only call mark_ready (approve for the next release) or go_live (put the release live) when the user asks you to.'
      : '6. You cannot mark the entry ready. When the user wants it approved, tell them a site owner must mark it ready in the CMS.',
  ].join('\n')

export function createArecaMcpServer(actor: McpActor): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: serverInstructions(actor) },
  )

  const registry = new ToolRegistry(server, actor)
  registerSiteTools(registry)
  registerEntryTools(registry)
  registerEntryWorkflowTools(registry)
  registerGlobalTools(registry)
  registerAssetTools(registry)
  registerPublishingTools(registry)
  registerSchemaTools(registry)
  registerLanguageTools(registry)

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
