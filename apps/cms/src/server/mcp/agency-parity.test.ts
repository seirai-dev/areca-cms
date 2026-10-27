import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'

import { z } from '#/lib/zod'

import {
  agencyInputSchema,
  environmentRefusal,
  withSiteEcho,
} from './agency-call'
import { AGENCY_NAVIGATION } from './agency-navigation'
import {
  AGENCY_TOOL_EXCEPTIONS,
  agencyServerInstructions,
  registerAgencyTools,
} from './agency-server'
import type { AgencyPrincipal, McpActor } from './keys'
import { registerPerSiteTools } from './server'
import type { McpSiteContext } from './site-context'
import { SITE_TOOLS } from './tool-catalog'
import { DEVELOPMENT_ONLY, PRODUCTION_ONLY } from './tool-kit'
import type { SiteEnvironment } from './tool-kit'

/** A server stub that records every registered tool, as the SDK would see it. */
type Recorded = { description: string; inputSchema: z.ZodObject }
function recorder() {
  const tools = new Map<string, Recorded>()
  const server = {
    registerTool: (
      name: string,
      config: { description?: string; inputSchema?: unknown },
    ) => {
      tools.set(name, {
        description: config.description ?? '',
        inputSchema: config.inputSchema as z.ZodObject,
      })
    },
  }
  return { tools, server: server as unknown as Pick<McpServer, 'registerTool'> }
}

const agencyPrincipal: AgencyPrincipal = {
  scope: 'agency',
  role: 'agency',
  keyId: 'key-1',
  keyName: 'Parity key',
  credential: 'key',
  userId: 'user-1',
  userName: 'Agency Admin',
  user: { id: 'user-1', isAgencyAdmin: true },
}

/** The per-site actor a connector would build for one site, with agency rights. */
const siteActor: McpActor = {
  keyId: 'key-1',
  keyName: 'Parity key',
  credential: 'key',
  scope: 'site',
  userId: 'user-1',
  userName: 'Agency Admin',
  siteId: 'site-1',
  siteSlug: 'acme',
  siteName: 'Acme',
  organizationId: 'org-1',
  role: 'agency',
  allowGoLive: true,
}

const production: McpSiteContext = {
  environment: 'production',
  productionSlug: null,
  devSlug: 'acme-dev',
}
const development: McpSiteContext = {
  environment: 'development',
  productionSlug: 'acme',
  devSlug: null,
}

const navigationNames = AGENCY_NAVIGATION.map((tool) => tool.name)

/** Whether a site tool is listed for an environment (the per-site connector's rule). */
function listedIn(name: string, environment: SiteEnvironment): boolean {
  const tool = SITE_TOOLS.find((entry) => entry.name === name)
  return !tool?.environments || tool.environments.includes(environment)
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort()
}

describe('agency connector parity with the per-site connector', () => {
  it('lists the same tools as the per-site connector for each environment, plus navigation', () => {
    const agency = recorder()
    registerAgencyTools(agency.server, agencyPrincipal)
    const agencyNames = [...agency.tools.keys()]

    for (const [environment, context] of [
      ['production', production],
      ['development', development],
    ] as const) {
      const perSite = recorder()
      registerPerSiteTools(perSite.server, siteActor, context)

      const exceptions = new Set(AGENCY_TOOL_EXCEPTIONS)
      const perSiteNames = [...perSite.tools.keys()]
      const agencyForEnvironment = agencyNames.filter(
        (name) => navigationNames.includes(name) || listedIn(name, environment),
      )
      expect(
        sorted(agencyForEnvironment.filter((name) => !exceptions.has(name))),
      ).toEqual(
        sorted(
          [...perSiteNames, ...navigationNames].filter(
            (name) => !exceptions.has(name),
          ),
        ),
      )
    }
  })

  it('gives every shared tool the per-site schema plus a required site argument', () => {
    const agency = recorder()
    registerAgencyTools(agency.server, agencyPrincipal)
    const perSite = recorder()
    registerPerSiteTools(perSite.server, siteActor, production)

    for (const [name, tool] of perSite.tools) {
      const own = z.toJSONSchema(tool.inputSchema) as {
        properties?: Record<string, unknown>
        required?: string[]
      }
      const shared = agency.tools.get(name)
      expect(shared, name).toBeDefined()
      const wrapped = z.toJSONSchema(shared!.inputSchema) as {
        properties?: Record<string, unknown>
        required?: string[]
      }
      const { site, ...rest } = wrapped.properties ?? {}
      expect(site, `${name} site argument`).toMatchObject({
        type: 'string',
        description: expect.stringContaining('site slug'),
      })
      expect(rest, name).toEqual(own.properties ?? {})
      expect(sorted(wrapped.required ?? []), name).toEqual(
        sorted([...(own.required ?? []), 'site']),
      )
      expect(shared!.description.startsWith(tool.description), name).toBe(true)
    }
  })

  it('keeps the named exception list empty in v1', () => {
    expect(AGENCY_TOOL_EXCEPTIONS).toEqual([])
  })

  it('does not reuse a site argument name a per-site tool already takes', () => {
    for (const tool of SITE_TOOLS) {
      expect(tool.inputSchema.shape, tool.name).not.toHaveProperty('site')
    }
  })

  it('adds the site argument to any schema without changing its other fields', () => {
    const schema = z.object({ id: z.string(), limit: z.number().optional() })
    const wrapped = agencyInputSchema(schema)
    expect(Object.keys(wrapped.shape)).toEqual(['id', 'limit', 'site'])
    expect(wrapped.parse({ id: 'a', site: 'acme' })).toEqual({
      id: 'a',
      site: 'acme',
    })
    expect(() => wrapped.parse({ id: 'a' })).toThrow()
  })
})

describe('environment refusals (Decision 9)', () => {
  const goLive = SITE_TOOLS.find((tool) => tool.name === 'go_live')!
  const push = SITE_TOOLS.find((tool) => tool.name === 'push_to_production')!

  it('refuses a production-only tool on a development environment, and says what to do', () => {
    expect(environmentRefusal(goLive, 'development')).toBe(
      "go_live isn't available on development environments. Push to production first.",
    )
    expect(
      environmentRefusal(
        { name: 'get_release_status', environments: PRODUCTION_ONLY },
        'development',
      ),
    ).toBe(
      "get_release_status isn't available on development environments: they have no releases.",
    )
    expect(
      environmentRefusal(
        { name: 'schedule_entry', environments: PRODUCTION_ONLY },
        'development',
      ),
    ).toBe("Scheduling isn't available on development environments.")
    expect(goLive.environments).toBe(PRODUCTION_ONLY)
  })

  it('refuses a development-only tool on a production site', () => {
    expect(environmentRefusal(push, 'production')).toBe(
      "push_to_production only works on a development environment. Use the site's dev environment slug (see list_sites).",
    )
    expect(push.environments).toBe(DEVELOPMENT_ONLY)
  })

  it('allows a tool on the environment it fits, and any tool that fits both', () => {
    expect(environmentRefusal(goLive, 'production')).toBeNull()
    expect(push.environments).toEqual(DEVELOPMENT_ONLY)
    const getSiteInfo = SITE_TOOLS.find(
      (tool) => tool.name === 'get_site_info',
    )!
    expect(environmentRefusal(getSiteInfo, 'development')).toBeNull()
    expect(environmentRefusal(getSiteInfo, 'production')).toBeNull()
  })
})

describe('site echo on results', () => {
  const echo = {
    slug: 'acme',
    name: 'Acme',
    client: 'Acme Ltd',
    environment: 'production' as const,
  }

  it('adds a site object to an object result', () => {
    expect(withSiteEcho({ id: 'e1' }, echo)).toEqual({ id: 'e1', site: echo })
  })

  it('merges with a site object the tool already returns', () => {
    expect(
      withSiteEcho(
        { site: { id: 's1', productionUrl: 'https://a.test' } },
        echo,
      ),
    ).toEqual({
      site: { ...echo, id: 's1', productionUrl: 'https://a.test' },
    })
  })

  it('wraps a string result', () => {
    expect(withSiteEcho('Done.', echo)).toEqual({ site: echo, result: 'Done.' })
  })

  it('wraps an array result rather than mixing keys into it', () => {
    expect(withSiteEcho([1, 2], echo)).toEqual({ site: echo, result: [1, 2] })
  })
})

describe('agency server instructions', () => {
  const text = agencyServerInstructions()

  it('names the site argument and the navigation tools to start with', () => {
    expect(text).toContain('"site"')
    expect(text).toContain('list_sites')
    expect(text).toContain('find_site')
  })

  it('does not steer the model toward development environments', () => {
    expect(text).not.toMatch(/prefer[^.]*(dev|development)/i)
    expect(text).not.toMatch(/(dev|development)[^.]*\bprefer/i)
  })

  it('asks for confirmation before production writes', () => {
    expect(text).toMatch(/production[^.]*confirmation/i)
  })
})

describe('agency sites are resolved only through agency-access.ts', () => {
  const dir = __dirname
  const read = (file: string) => readFileSync(join(dir, file), 'utf8')

  it('reads the site table only in agency-access.ts', () => {
    for (const file of [
      'agency-call.ts',
      'agency-server.ts',
      'agency-http.ts',
      'agency-navigation.ts',
    ]) {
      expect(read(file), file).not.toMatch(/from\(site\)/)
    }
  })

  it('checks reachability on every resolve', () => {
    expect(read('agency-call.ts')).toContain('resolveAgencySite(')
    const access = read('agency-access.ts')
    const resolve = access.slice(
      access.indexOf('export async function resolveAgencySite'),
    )
    expect(resolve).toContain('assertAgencySiteReachable(')
  })
})
