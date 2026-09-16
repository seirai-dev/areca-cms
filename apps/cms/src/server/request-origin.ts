const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function validateCookieMutationOrigin(
  request: Request,
): Response | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null
  if (!request.headers.has('cookie')) return null

  const pathname = new URL(request.url).pathname
  if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) return null

  const origin = request.headers.get('origin')
  if (!origin) return new Response('Forbidden', { status: 403 })

  try {
    const originUrl = new URL(origin)
    const host = request.headers.get('host')?.trim()
    const forwardedProto = request.headers
      .get('x-forwarded-proto')
      ?.split(',')[0]
      ?.trim()
    const protocol = forwardedProto
      ? `${forwardedProto}:`
      : new URL(request.url).protocol

    if (!host || originUrl.origin !== `${protocol}//${host}`) {
      return new Response('Forbidden', { status: 403 })
    }
  } catch {
    return new Response('Forbidden', { status: 403 })
  }

  return null
}
