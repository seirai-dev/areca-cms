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

/** Runs one tool call: access check, audit labelling, and error mapping. */
export async function runTool<TSchema extends z.ZodObject>(
  actor: McpActor,
  site: McpSiteContext,
  spec: ToolSpec<TSchema>,
  input: z.output<TSchema>,
): Promise<CallToolResult> {
  return withAuditContext(
    { via: 'mcp', mcpKeyId: actor.keyId, mcpKeyName: actor.keyName },
    async () => {
      try {
        requireAccess(actor, spec.access ?? 'everyone', spec.deniedMessage)
        const result = await spec.run(input, actor, site)
        const text =
          typeof result === 'string'
            ? result
            : JSON.stringify(result ?? null, null, 2)
        return { content: [{ type: 'text', text }] }
      } catch (error) {
        return toToolError(error)
      }
    },
  )
}

/**
 * Registers the tools this actor may use. Tools outside the actor's role or
 * the site's environment are not advertised at all, so the model never plans
 * around them, and a direct call to them finds no tool.
 */
export class ToolRegistry {
  constructor(
    private readonly server: McpServer,
    private readonly actor: McpActor,
    private readonly site: McpSiteContext,
  ) {}

  add<TSchema extends z.ZodObject>(spec: ToolSpec<TSchema>): void {
    if (!canUseTool(this.actor, spec.access ?? 'everyone')) return
    if (
      spec.environments &&
      !spec.environments.includes(this.site.environment)
    ) {
      return
    }
    // Typed as the base schema so the SDK's callback type resolves; the
    // generic S is restored by parsing the input in the callback below.
    const inputSchema: z.ZodObject = spec.inputSchema
    this.server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema,
        annotations: spec.annotations,
      },
      // The SDK has already validated the input; parsing again gives it the
      // schema's output type without a cast.
      (input: unknown) =>
        runTool(this.actor, this.site, spec, spec.inputSchema.parse(input)),
    )
  }
}
