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
  SITE_NOTE,
  agencyServerInstructions,
  registerAgencyTools,
} from './agency-server'
import type { AgencyPrincipal, McpActor } from './keys'
import { registerPerSiteTools } from './server'
import type { McpSiteContext } from './site-context'
import { SITE_TOOLS } from './tool-catalog'
import {
  AGENCY_GO_LIVE_NOTE,
  DEVELOPMENT_ONLY,
  GO_LIVE_KEY_NOTE,
  GO_LIVE_PERMISSION_NOTE,
  PRODUCTION_ONLY,
  agencyDescription,
} from './tool-kit'
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

type JsonSchema = {
  properties?: Record<string, unknown>
  required?: string[]
  [key: string]: unknown
}

/** A zod input schema as JSON Schema, the form a client receives. */
function jsonSchemaOf(schema: z.ZodObject): JsonSchema {
  return z.toJSONSchema(schema)
}

/**
 * The agency schema with its `site` argument (and its `required` entry) taken
 * out. Nothing else is removed, so the rest must match the per-site schema exactly.
 */
function withoutSite(schema: JsonSchema): JsonSchema {
  const { properties = {}, required = [], ...rest } = schema
  const { site: _site, ...others } = properties
  const remaining = required.filter((name) => name !== 'site')
  return {
    ...rest,
    properties: others,
    ...(remaining.length > 0 ? { required: remaining } : {}),
  }
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

  it('gives every site tool, in both environments, the per-site JSON schema plus a required site argument and nothing else', () => {
    const agency = recorder()
    registerAgencyTools(agency.server, agencyPrincipal)

    for (const [environment, context] of [
      ['production', production],
      ['development', development],
    ] as const) {
      const perSite = recorder()
      registerPerSiteTools(perSite.server, siteActor, context)
      expect(perSite.tools.size, environment).toBeGreaterThan(0)

      for (const [name, tool] of perSite.tools) {
        const label = `${environment}: ${name}`
        const shared = agency.tools.get(name)
        expect(shared, label).toBeDefined()
        const sharedJson = jsonSchemaOf(shared!.inputSchema)
        expect(sharedJson.properties?.site, label).toMatchObject({
          type: 'string',
          description: expect.stringContaining('site slug'),
        })
        expect(sharedJson.required, label).toContain('site')
        expect(withoutSite(sharedJson), label).toEqual(
          jsonSchemaOf(tool.inputSchema),
        )
      }
    }
  })

  it('fails the schema comparison when any part of a schema differs', () => {
    const tool = SITE_TOOLS.find((entry) => entry.name === 'create_entry')!
    const agency = recorder()
    registerAgencyTools(agency.server, agencyPrincipal)
    const sharedJson = jsonSchemaOf(
      agency.tools.get('create_entry')!.inputSchema,
    )
    const perSiteJson = jsonSchemaOf(tool.inputSchema)
    const differs = (actual: JsonSchema) => {
      try {
        expect(actual).toEqual(perSiteJson)
        return false
      } catch {
        return true
      }
    }

    // The comparison itself: a changed property, a changed description, or a
    // changed required list must each be seen, and the site argument must not be.
    expect(differs(withoutSite(sharedJson))).toBe(false)
    const extraProperty = structuredClone(withoutSite(sharedJson))
    extraProperty.properties!.extra = { type: 'string' }
    expect(differs(extraProperty)).toBe(true)
    const renamedDescription = structuredClone(withoutSite(sharedJson))
    const first = Object.keys(renamedDescription.properties!)[0]
    renamedDescription.properties![first] = {
      ...(renamedDescription.properties![first] as object),
      description: 'changed',
    }
    expect(differs(renamedDescription)).toBe(true)
    const changedRequired = structuredClone(withoutSite(sharedJson))
    changedRequired.required = [...(changedRequired.required ?? []), 'extra']
    expect(differs(changedRequired)).toBe(true)
  })

  it('describes every agency site tool as its per-site description, with the go-live sentence swapped, and the site note', () => {
    const agency = recorder()
    registerAgencyTools(agency.server, agencyPrincipal)
    for (const context of [production, development]) {
      const perSite = recorder()
      registerPerSiteTools(perSite.server, siteActor, context)
      for (const [name, tool] of perSite.tools) {
        expect(agency.tools.get(name)!.description, name).toBe(
          `${agencyDescription(tool.description)}\n\n${SITE_NOTE}`,
        )
      }
    }
  })

  it('gives the go-live tools the agency go-live sentence, and keeps the per-site sentence per-site', () => {
    const agency = recorder()
    registerAgencyTools(agency.server, agencyPrincipal)
    const perSite = recorder()
    registerPerSiteTools(perSite.server, siteActor, production)
    const goLiveTools = [
      'go_live',
      'rollback',
      'cancel_build',
      'schedule_entry',
    ]
    for (const name of goLiveTools) {
      const onAgency = agency.tools.get(name)!.description
      expect(onAgency, name).toContain(AGENCY_GO_LIVE_NOTE)
      expect(onAgency, name).not.toContain(GO_LIVE_KEY_NOTE)
      expect(onAgency, name).not.toContain(GO_LIVE_PERMISSION_NOTE)
    }
    // The per-site descriptions are unchanged: they still say what a key needs.
    expect(perSite.tools.get('go_live')!.description).toContain(
      GO_LIVE_KEY_NOTE,
    )
    expect(perSite.tools.get('schedule_entry')!.description).toContain(
      GO_LIVE_PERMISSION_NOTE,
    )
    expect(perSite.tools.get('schedule_entry')!.description).not.toContain(
      AGENCY_GO_LIVE_NOTE,
    )
  })

  it('never mentions a per-site key flag on the agency connector, in any tool or in the instructions', () => {
    const agency = recorder()
    registerAgencyTools(agency.server, agencyPrincipal)
    for (const [name, tool] of agency.tools) {
      expect(tool.description, name).not.toContain('Allow going live')
      expect(tool.description, name).not.toContain(
        'Requires permission to go live',
      )
    }
    expect(agencyServerInstructions()).not.toContain('Allow going live')
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
