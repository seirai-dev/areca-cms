import type {
  CallToolResult,
  McpServer,
  ToolAnnotations,
} from '@modelcontextprotocol/server'
import type { z } from '#/lib/zod'

import { withAuditContext } from '#/server/audit-context'

import { toToolError } from './errors'
import { canUseTool, requireAccess } from './guard'
import type { ToolAccess } from './guard'
import type { McpActor } from './keys'
import type { McpSiteContext } from './site-context'

/** The kind of site a connector serves. */
export type SiteEnvironment = McpSiteContext['environment']

/** Tools that have no meaning on a development environment (no releases, no schedule). */
export const PRODUCTION_ONLY: readonly SiteEnvironment[] = ['production']

/** Tools for a development environment only (reset, push and copy). */
export const DEVELOPMENT_ONLY: readonly SiteEnvironment[] = ['development']

export type ToolSpec<TSchema extends z.ZodObject> = {
  name: string
  title: string
  /** Read by the model: say what the tool does, when to use it, and the input formats. */
  description: string
  inputSchema: TSchema
  access?: ToolAccess
  /**
   * The site kinds whose connectors list this tool. Omitted means both. A tool
   * for development environments only is `['development']`; a tool that does
   * not apply there is `['production']`.
   */
  environments?: readonly SiteEnvironment[]
  /** Overrides the default "not allowed" text for owner-only tools. */
  deniedMessage?: string
  annotations: ToolAnnotations
  /** Returns a string (sent as is) or a JSON-serialisable value (sent as pretty JSON). */
  run: (
    input: z.output<TSchema>,
    actor: McpActor,
    site: McpSiteContext,
  ) => Promise<unknown>
}

/**
 * A tool as data: everything a connector needs to list it and call it. The
 * input schema is erased to the base object type, so tools of different
 * shapes can sit in one list. Built from a ToolSpec by `toolEntry`.
 */
export type ToolEntry = {
  name: string
  title: string
  description: string
  inputSchema: z.ZodObject
  access: ToolAccess
  environments?: readonly SiteEnvironment[]
  deniedMessage?: string
  annotations: ToolAnnotations
  /** Parses the raw input with this tool's own schema, then runs it for the site. */
  invoke: (
    input: unknown,
    actor: McpActor,
    site: McpSiteContext,
  ) => Promise<unknown>
}

export function toolEntry<TSchema extends z.ZodObject>(
  spec: ToolSpec<TSchema>,
): ToolEntry {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    access: spec.access ?? 'everyone',
    environments: spec.environments,
    deniedMessage: spec.deniedMessage,
    annotations: spec.annotations,
    invoke: (input, actor, site) =>
      spec.run(spec.inputSchema.parse(input), actor, site),
  }
}

/** What the tool modules register into. The same list then serves every connector. */
export type ToolCollector = {
  add: <TSchema extends z.ZodObject>(spec: ToolSpec<TSchema>) => void
}

/** Collects tool specs as data, in registration order. */
export class ToolCatalog {
  readonly entries: ToolEntry[] = []

  add<TSchema extends z.ZodObject>(spec: ToolSpec<TSchema>): void {
    this.entries.push(toolEntry(spec))
  }
}

/** A tool result: a string is sent as is, anything else as pretty JSON. */
export function toCallResult(result: unknown): CallToolResult {
  const text =
    typeof result === 'string'
      ? result
      : JSON.stringify(result ?? null, null, 2)
  return { content: [{ type: 'text', text }] }
}

/** Runs one per-site tool call: access check, audit labelling, and error mapping. */
export async function runTool(
  actor: McpActor,
  site: McpSiteContext,
  entry: ToolEntry,
  input: unknown,
): Promise<CallToolResult> {
  return withAuditContext(
    {
      via: 'mcp',
      mcpKeyId: actor.keyId,
      mcpKeyName: actor.keyName,
      mcpCredential: actor.credential,
    },
    async () => {
      try {
        requireAccess(actor, entry.access, entry.deniedMessage)
        return toCallResult(await entry.invoke(input, actor, site))
      } catch (error) {
        return toToolError(error)
      }
    },
  )
}

/**
 * Registers the tools this per-site actor may use. Tools outside the actor's
 * role or the site's environment are not advertised at all, so the model never
 * plans around them, and a direct call to them finds no tool.
 */
export class ToolRegistry {
  constructor(
    private readonly server: Pick<McpServer, 'registerTool'>,
    private readonly actor: McpActor,
    private readonly site: McpSiteContext,
  ) {}

  add(entry: ToolEntry): void {
    if (!canUseTool(this.actor, entry.access)) return
    if (
      entry.environments &&
      !entry.environments.includes(this.site.environment)
    ) {
      return
    }
    // The SDK has already validated the input; the entry parses it again to
    // give it the schema's output type.
    this.server.registerTool(
      entry.name,
      {
        title: entry.title,
        description: entry.description,
        inputSchema: entry.inputSchema,
        annotations: entry.annotations,
      },
      (input: unknown) => runTool(this.actor, this.site, entry, input),
    )
  }
}
