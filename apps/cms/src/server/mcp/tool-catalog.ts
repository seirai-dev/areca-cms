import { registerAssetTools } from './tools/assets'
import { registerDevEnvTools } from './tools/dev-env'
import { registerEntryTools } from './tools/entries'
import { registerEntryWorkflowTools } from './tools/entry-workflow'
import { registerGlobalTools } from './tools/globals'
import { registerLanguageTools } from './tools/languages'
import { registerPublishingTools } from './tools/publishing'
import { registerSchemaTools } from './tools/schema'
import { registerSiteTools } from './tools/site'
import { ToolCatalog } from './tool-kit'
import type { ToolEntry } from './tool-kit'

/**
 * Every per-site tool, defined once, in registration order. The per-site
 * connector lists the ones its role and environment allow; the agency
 * connector lists all of them with a `site` argument (agency-server.ts).
 */
function collectSiteTools(): ToolEntry[] {
  const catalog = new ToolCatalog()
  registerSiteTools(catalog)
  registerEntryTools(catalog)
  registerEntryWorkflowTools(catalog)
  registerGlobalTools(catalog)
  registerAssetTools(catalog)
  registerPublishingTools(catalog)
  registerSchemaTools(catalog)
  registerLanguageTools(catalog)
  registerDevEnvTools(catalog)
  return catalog.entries
}

export const SITE_TOOLS: readonly ToolEntry[] = collectSiteTools()
