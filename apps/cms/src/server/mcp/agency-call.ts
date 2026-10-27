import type { CallToolResult } from '@modelcontextprotocol/server'
import { z } from '#/lib/zod'

import { withAuditContext } from '#/server/audit-context'

import { resolveAgencySite } from './agency-access'
import type { AgencySite } from './agency-access'
import { toToolError, toolError } from './errors'
import { requireAccess } from './guard'
import type { AgencyPrincipal, McpActor } from './keys'
import { loadSiteContext } from './site-context'
import type { McpSiteContext } from './site-context'
import { toCallResult } from './tool-kit'
import type { SiteEnvironment, ToolEntry } from './tool-kit'

/** The argument every agency site tool takes, and how the model is told about it. */
export const SITE_ARGUMENT_DESCRIPTION =
  'The site slug, for example "acme" or "acme-dev". Get it from list_sites or find_site. The call acts on this one site.'

const SITE_ARGUMENT = z.object({ site: z.string().min(1) })

/** A per-site schema plus the required `site` argument. Nothing else changes. */
export function agencyInputSchema(schema: z.ZodObject): z.ZodObject {
  return schema.extend({
    site: z.string().min(1).describe(SITE_ARGUMENT_DESCRIPTION),
  })
}

/** Where a result happened, echoed on every agency result. */
export type SiteEcho = {
  slug: string
  name: string
  client: string
  environment: SiteEnvironment
}

export function siteEchoOf(
  row: AgencySite,
  environment: SiteEnvironment,
): SiteEcho {
  return {
    slug: row.slug,
    name: row.name,
    client: row.clientName,
    environment,
  }
}

/**
 * The actor for one call: the principal acting on one site with agency rights.
 * Going live needs no flag here (docs/design/agency-mcp.md, Decision 10).
 */
export function siteActorFor(
  principal: AgencyPrincipal,
  row: AgencySite,
): McpActor {
  return {
    keyId: principal.keyId,
    keyName: principal.keyName,
    credential: principal.credential,
    scope: 'agency',
    userId: principal.userId,
    userName: principal.userName,
    siteId: row.id,
    siteSlug: row.slug,
    siteName: row.name,
    organizationId: row.organizationId,
    role: 'agency',
    allowGoLive: true,
  }
}

/**
 * The refusal for a tool that does not fit the site's environment, or null when
 * it fits. Production-only tools name the push as the way forward; the others
 * say they belong on development environments.
 */
export function environmentRefusal(
  tool: Pick<ToolEntry, 'name' | 'environments'>,
  environment: SiteEnvironment,
): string | null {
  if (!tool.environments || tool.environments.includes(environment)) return null
  if (environment === 'development') {
    return `${tool.name} isn't available on development environments. Push to production first.`
  }
  return `${tool.name} is only available on development environments.`
}

/**
 * Adds the site echo to a result. Object results gain a `site` key (merged
 * with any `site` the tool already returns, such as get_site_info's). Other
 * results are wrapped as `{ site, result }`.
 */
export function withSiteEcho(result: unknown, echo: SiteEcho): unknown {
  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    const existing: object =
      'site' in result &&
      typeof result.site === 'object' &&
      result.site !== null
        ? result.site
        : {}
    return { ...result, site: { ...echo, ...existing } }
  }
  return { site: echo, result }
}

/**
 * Runs one agency tool call: resolve the named site (reachability is checked
 * here), build the per-call actor, refuse on a wrong environment, run the
 * tool's own code, and echo the site. Audited as `via: 'mcp-agency'`.
 */
export async function runAgencyTool(
  principal: AgencyPrincipal,
  tool: ToolEntry,
  rawInput: unknown,
): Promise<CallToolResult> {
  return withAuditContext(
    {
      via: 'mcp-agency',
      mcpKeyId: principal.keyId,
      mcpKeyName: principal.keyName,
      mcpCredential: principal.credential,
    },
    async () => {
      try {
        const { site: slug } = SITE_ARGUMENT.parse(rawInput)
        const row = await resolveAgencySite(principal.user, slug)
        const actor = siteActorFor(principal, row)
        requireAccess(actor, tool.access, tool.deniedMessage)
        const context: McpSiteContext = await loadSiteContext(row.id)
        const refusal = environmentRefusal(tool, context.environment)
        if (refusal) return toolError(refusal)
        const result = await tool.invoke(rawInput, actor, context)
        return toCallResult(
          withSiteEcho(result, siteEchoOf(row, context.environment)),
        )
      } catch (error) {
        return toToolError(error)
      }
    },
  )
}

/** Runs a navigation tool (no site argument). Audited the same way as site tools. */
export async function runNavigationCall(
  principal: AgencyPrincipal,
  run: () => Promise<unknown>,
): Promise<CallToolResult> {
  return withAuditContext(
    {
      via: 'mcp-agency',
      mcpKeyId: principal.keyId,
      mcpKeyName: principal.keyName,
      mcpCredential: principal.credential,
    },
    async () => {
      try {
        return toCallResult(await run())
      } catch (error) {
        return toToolError(error)
      }
    },
  )
}
