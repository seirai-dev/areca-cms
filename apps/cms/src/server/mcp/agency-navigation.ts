import type { ToolAnnotations } from '@modelcontextprotocol/server'
import { z } from '#/lib/zod'

import { isDevSite } from '#/lib/site-environment'
import { AppError } from '#/server/http/app-error'

import { agencyReachableSites } from './agency-access'
import type { AgencySite } from './agency-access'
import { db } from '#/db'
import type { AgencyPrincipal } from './keys'
import { loadReleaseStates } from './release-state'
import type { SiteEnvironment } from './tool-kit'

/**
 * Navigation tools for the agency connector only: they find the site a
 * per-site tool then acts on. They live here, not in tools/, because they are
 * not per-site tools (docs/design/agency-mcp.md, Decision 6).
 */

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, idempotentHint: true }

/** One site, as the navigation tools show it. */
export type NavigationRow = {
  slug: string
  name: string
  client: string
  environment: SiteEnvironment
  /** The linked site: the production site of a development environment, or its development environment. */
  linked: { environment: SiteEnvironment; slug: string } | null
  publishingMode: string
  /** A live release exists. Always false on a development environment. */
  live: boolean
  /** Approved entries waiting for the next go live. Always 0 on a development environment. */
  pendingReadyChanges: number
}

/**
 * Rows for the reachable sites that pass `include`. Linked sites are looked up
 * among all reachable sites, so a dev env and its production site point at
 * each other.
 */
async function navigationRows(
  principal: AgencyPrincipal,
  include: (site: AgencySite) => boolean,
): Promise<NavigationRow[]> {
  const sites = await agencyReachableSites(db, principal.user)
  const byId = new Map(sites.map((row) => [row.id, row]))
  const listed = sites.filter(include)
  // A site deleted after the list was read has no state and is not listed.
  const states = await loadReleaseStates(listed.map((row) => row.id))
  const rows: NavigationRow[] = []
  for (const row of listed) {
    const environment: SiteEnvironment = isDevSite(row)
      ? 'development'
      : 'production'
    const linkedSite = isDevSite(row)
      ? row.parentSiteId
        ? byId.get(row.parentSiteId)
        : undefined
      : sites.find((other) => other.parentSiteId === row.id)
    const state = states.get(row.id)
    if (!state) continue
    rows.push({
      slug: row.slug,
      name: row.name,
      client: row.clientName,
      environment,
      linked: linkedSite
        ? {
            environment: isDevSite(linkedSite) ? 'development' : 'production',
            slug: linkedSite.slug,
          }
        : null,
      publishingMode: row.publishingMode,
      live: state.live,
      pendingReadyChanges: state.pendingIds.size,
    })
  }
  return rows
}

const FIND_LIMIT = 50

/**
 * The slug of the client a `client` argument names among the reachable sites,
 * or null when none does. A client slug (case-insensitive) wins. Otherwise the
 * argument must be the name of exactly one client: client names are not unique,
 * so two clients with one name are refused, with their slugs to choose from.
 */
export function resolveClientSlug(
  wanted: string,
  sites: readonly AgencySite[],
): string | null {
  const clients = new Map(sites.map((row) => [row.clientSlug, row.clientName]))
  const needle = wanted.toLowerCase()
  const bySlug = [...clients.keys()].find(
    (slug) => slug.toLowerCase() === needle,
  )
  if (bySlug !== undefined) return bySlug

  const byName = [...clients].filter(
    ([, name]) => name.toLowerCase() === needle,
  )
  if (byName.length === 0) return null
  if (byName.length > 1) {
    const slugs = byName.map(([slug]) => slug).sort()
    throw new AppError(
      `Several clients are named "${byName[0][1]}". Use one of these client slugs: ${slugs.join(', ')}.`,
    )
  }
  return byName[0][0]
}

export type NavigationTool = {
  name: string
  title: string
  description: string
  inputSchema: z.ZodObject
  annotations: ToolAnnotations
  /** Parses the raw input with this tool's schema, then runs it for the principal. */
  invoke: (input: unknown, principal: AgencyPrincipal) => Promise<unknown>
}

function navigationTool<TSchema extends z.ZodObject>(spec: {
  name: string
  title: string
  description: string
  inputSchema: TSchema
  run: (
    input: z.output<TSchema>,
    principal: AgencyPrincipal,
  ) => Promise<unknown>
}): NavigationTool {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: READ_ONLY,
    invoke: (input, principal) =>
      spec.run(spec.inputSchema.parse(input), principal),
  }
}

export const AGENCY_NAVIGATION: readonly NavigationTool[] = [
  navigationTool({
    name: 'list_clients',
    title: 'List clients',
    description:
      'Lists the clients (organizations) you can reach through this connection, with their slugs, names and how many sites each has. Call this to find a client slug for list_sites. Read-only.',
    inputSchema: z.object({}),
    run: async (_input, principal) => {
      const sites = await agencyReachableSites(db, principal.user)
      const clients = new Map<
        string,
        { slug: string; name: string; sites: number }
      >()
      for (const row of sites) {
        const entry = clients.get(row.clientSlug) ?? {
          slug: row.clientSlug,
          name: row.clientName,
          sites: 0,
        }
        entry.sites += 1
        clients.set(row.clientSlug, entry)
      }
      return {
        clients: [...clients.values()].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      }
    },
  }),
  navigationTool({
    name: 'list_sites',
    title: 'List sites',
    description:
      'Lists the sites you can reach, production and development environments, with the slug to pass as "site" to every other tool. Each row has: slug, name, client, environment, linked (the production site of a development environment, or its development environment), publishingMode, live (a live release exists) and pendingReadyChanges (approved entries waiting for the next go live). Pass client to list one client, by its slug or by its name when only one client has that name. Read-only.',
    inputSchema: z.object({
      client: z
        .string()
        .min(1)
        .optional()
        .describe(
          'A client slug, or a client name that only one client has, from list_clients. Leave out for every client.',
        ),
    }),
    run: async (input, principal) => {
      // An unknown client lists nothing, as it always has.
      const sites = await agencyReachableSites(db, principal.user)
      const wanted =
        input.client === undefined
          ? undefined
          : resolveClientSlug(input.client, sites)
      const rows = await navigationRows(principal, (row) =>
        wanted === undefined ? true : row.clientSlug === wanted,
      )
      return { sites: rows }
    },
  }),
  navigationTool({
    name: 'find_site',
    title: 'Find site',
    description:
      'Finds sites by text: matches the site name, slug, client name and production URL, case-insensitively. Returns the same rows as list_sites, up to 50. Use it when you know a name, not a slug. Read-only.',
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .max(200)
        .describe('Text to find, for example a client name or a site name.'),
    }),
    run: async (input, principal) => {
      const needle = input.query.trim().toLowerCase()
      const matches = (row: AgencySite) =>
        [row.name, row.slug, row.clientName, row.productionUrl].some((field) =>
          field.toLowerCase().includes(needle),
        )
      const all = await navigationRows(principal, matches)
      return {
        sites: all.slice(0, FIND_LIMIT),
        ...(all.length > FIND_LIMIT
          ? {
              truncated: true,
              note: `Only the first ${FIND_LIMIT} matches are shown. Use a more specific query.`,
            }
          : {}),
      }
    },
  }),
]
