import { McpServer } from '@modelcontextprotocol/server'

import {
  runAgencyTool,
  runNavigationCall,
  agencyInputSchema,
} from './agency-call'
import { AGENCY_NAVIGATION } from './agency-navigation'
import type { AgencyPrincipal } from './keys'
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from './server'
import {
  CODE_BLOCK_INSTRUCTION,
  RICH_TEXT_MARKDOWN_INSTRUCTION,
} from './rich-text-guide'
import { SITE_TOOLS } from './tool-catalog'
import { agencyDescription } from './tool-kit'

/**
 * Tools deliberately missing from one of the two connectors. Empty in v1: both
 * connectors are built from the same list, so a difference needs a reason here
 * and a test that names it.
 */
export const AGENCY_TOOL_EXCEPTIONS: readonly string[] = []

/** Added to every site tool's description: the site argument is how the call finds its site. */
export const SITE_NOTE =
  'Acts on the site named by "site" (the slug from list_sites or find_site). Pass it on every call.'

/**
 * Read by the model once, at connection time. Agency-wide: no per-site facts
 * (get_site_info gives those). It does not say which environment to prefer.
 */
export function agencyServerInstructions(): string {
  return [
    'This server connects one AI app to every client and site of this agency, production and development environments alike. Every site tool takes a "site" argument: the site slug, for example "acme" or "acme-dev". There is no current site: each call acts on the site it names.',
    'Start with list_sites or find_site to find the slug. list_clients lists the clients. get_site_info({ site }) describes one site: its environment, your permissions and its collections.',
    'Every result has a "site" object (slug, name, client, environment). Use it to tell the user where each change happened.',
    "Before a change to a production site, name the client and the site, and get the user's confirmation first. Production changes reach visitors once they go live.",
    'A development environment holds changes that are not in production yet. Pushing to production is a review step: call push_to_production with dryRun first, show the list to the user, and apply only after they approve the planHash from that dry run. copy_entry_to_production copies one entry as a draft.',
    'Drafts are safe. Nothing you write changes the live site until it is approved and a go live happens.',
    RICH_TEXT_MARKDOWN_INSTRUCTION,
    CODE_BLOCK_INSTRUCTION,
    'Some tools only apply to one kind of environment. When a call is refused for that reason, the refusal says what to do; explain it to the user and use the right site.',
    'You are an agency admin: you may change collection schemas and site content sections, mark entries ready, and go live. Agency connections may go live, but only when the user asks, and the confirmation rule above still applies. If a site syncs its schema from code, prefer changing areca.config.ts.',
    'When an update fails with a version conflict, call get_entry again and reapply the change to the current version.',
  ].join('\n')
}

/**
 * The agency connector's server: every per-site tool (the same definitions,
 * with the `site` argument added) and the navigation tools. Each call is
 * resolved to one site in agency-call.ts.
 */
export function createArecaAgencyMcpServer(
  principal: AgencyPrincipal,
): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: agencyServerInstructions() },
  )
  registerAgencyTools(server, principal)
  return server
}

/**
 * Every site tool with the `site` argument, then the navigation tools. Split
 * out so the parity test can read the list without a server.
 */
export function registerAgencyTools(
  server: Pick<McpServer, 'registerTool'>,
  principal: AgencyPrincipal,
): void {
  for (const tool of SITE_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: `${agencyDescription(tool.description)}\n\n${SITE_NOTE}`,
        inputSchema: agencyInputSchema(tool.inputSchema),
        annotations: tool.annotations,
      },
      (input: unknown) => runAgencyTool(principal, tool, input),
    )
  }

  for (const tool of AGENCY_NAVIGATION) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      (input: unknown) =>
        runNavigationCall(principal, () => tool.invoke(input, principal)),
    )
  }
}
