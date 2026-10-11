/** HTTP authentication scheme names are case-insensitive (RFC 9110). */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  return header?.match(/^Bearer +([^\s]+) *$/i)?.[1] ?? null
}

/** Both MCP OAuth schemes consume the same per-token rate-limit budget. */
export function authorizationToken(request: Request): string | null {
  return (
    request.headers
      .get('authorization')
      ?.match(/^(?:Bearer|DPoP) +([^\s]+) *$/i)?.[1] ?? null
  )
}
