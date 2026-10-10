import { MCP_OAUTH_SCOPES } from './oauth-resource'

/**
 * Normalises a Dynamic Client Registration (RFC 7591) body before the plugin
 * validates it. Kept free of the Better Auth instance so it can be unit tested.
 *
 * The plugin registers clients as `application_type: "web"` unless told
 * otherwise. `web` accepts https redirects on non-loopback hosts only, so the
 * loopback redirects that desktop and CLI clients use (RFC 8252) are rejected.
 * `native` accepts those loopback http redirects, but also accepts custom
 * schemes, so it is only chosen when every redirect is one of the two forms
 * MCP clients actually use.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function parseUri(uri: unknown): URL | null {
  if (typeof uri !== 'string') return null
  try {
    return new URL(uri)
  } catch {
    return null
  }
}

/** `http://localhost`, `http://127.0.0.1` or `http://[::1]`, any port or path. */
export function isLoopbackHttpRedirect(uri: unknown): boolean {
  const url = parseUri(uri)
  return url !== null && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
}

export function isHttpsRedirect(uri: unknown): boolean {
  const url = parseUri(uri)
  return url !== null && url.protocol === 'https:'
}

/**
 * Chooses `application_type: "native"` for a registration whose redirects are
 * all https or loopback http and include at least one loopback redirect (for
 * example Claude Code, Cursor, Gemini CLI, or VS Code's `127.0.0.1` callback
 * next to `https://vscode.dev/redirect`). Any other registration is returned
 * unchanged, so the plugin applies its `web` rules and rejects it.
 *
 * An explicit `application_type` from the client always wins.
 */
export function registrationApplicationType(
  metadata: Record<string, unknown>,
): 'native' | undefined {
  if (metadata.application_type !== undefined) return undefined
  const uris = metadata.redirect_uris
  if (!Array.isArray(uris) || uris.length === 0) return undefined
  const allowed = uris.every(
    (uri) => isLoopbackHttpRedirect(uri) || isHttpsRedirect(uri),
  )
  const hasLoopback = uris.some((uri) => isLoopbackHttpRedirect(uri))
  return allowed && hasLoopback ? 'native' : undefined
}

/**
 * The registration body the plugin should see. Two changes:
 *
 * - `application_type` as described above.
 * - `scope` is always the full set of MCP scopes. A client that registers a
 *   subset (for example `mcp` alone) would otherwise be refused when it later
 *   asks for `offline_access`, because the plugin checks requested scopes
 *   against the client's registered scopes. Scopes this server does not know
 *   are still refused at authorization.
 */
export function normaliseRegistrationBody(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const applicationType = registrationApplicationType(metadata)
  return {
    ...metadata,
    ...(applicationType ? { application_type: applicationType } : {}),
    scope: MCP_OAUTH_SCOPES.join(' '),
  }
}
