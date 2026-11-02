import type { LookupAddress, LookupOptions } from 'node:dns'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'

import type { DeploymentAdapter } from './types'
import { sleep } from './shared'
import { resolveSafeHealthCheckUrl } from '#/server/http/outbound-url'
import type { ResolveHost } from '#/server/http/outbound-url'

type FetchFn = typeof fetch

/**
 * Options for the publication-aware health check shared by the deployment
 * adapters. Requests are pinned to the addresses checked for being public, and
 * redirects are followed only after the same check.
 */
export type HealthCheckOptions = {
  fetch?: FetchFn
  resolveHost?: ResolveHost
  allowInsecureHttp?: boolean
  allowPrivateHealthChecks?: boolean
}

export function createHealthChecker(
  opts: HealthCheckOptions,
): DeploymentAdapter['healthCheck'] {
  const fetchFn = opts.fetch ?? fetch

  return async function healthCheck(
    url,
    { timeoutMs, intervalMs, expectPublicationId },
  ) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        const res = await fetchHealthUrl(url, deadline)
        if (res.status === 200) {
          if (!expectPublicationId) return true
          const body = (await res.json()) as { publicationId?: string }
          if (body.publicationId === expectPublicationId) return true
        }
      } catch {
        // retry until timeout
      }
      const wait = Math.min(intervalMs, deadline - Date.now())
      if (wait <= 0) return false
      await sleep(wait)
    }
  }

  async function fetchHealthUrl(
    rawUrl: string,
    deadline: number,
    redirects = 0,
  ): Promise<Response> {
    const resolved = await resolveSafeHealthCheckUrl(rawUrl, {
      resolve: opts.resolveHost,
      allowInsecureHttp: opts.allowInsecureHttp,
      allowPrivateNetwork: opts.allowPrivateHealthChecks,
    })
    const { url } = resolved
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('Health-check timeout')
    const response = opts.fetch
      ? await fetchFn(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(remaining),
        })
      : await pinnedRequest(url, resolved.addresses, remaining)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirects >= 4) return response
      return fetchHealthUrl(
        new URL(location, url).href,
        deadline,
        redirects + 1,
      )
    }
    return response
  }
}

/**
 * Connects only to the addresses that were checked for being public, so DNS
 * cannot change between the check and the connection. Exported for tests.
 */
export function pinnedRequest(
  url: URL,
  addresses: string[],
  timeoutMs: number,
) {
  return new Promise<Response>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = transport(
      url,
      {
        signal: AbortSignal.timeout(timeoutMs),
        ...(addresses.length > 0 ? { lookup: pinnedLookup(addresses) } : {}),
      },
      (incoming) => {
        const chunks: Buffer[] = []
        let size = 0
        incoming.on('data', (chunk: Buffer) => {
          size += chunk.byteLength
          if (size > 64 * 1024) {
            request.destroy(new Error('Health-check response is too large'))
            return
          }
          chunks.push(chunk)
        })
        incoming.on('end', () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: incoming.statusCode ?? 500,
              headers: incoming.headers as Record<string, string>,
            }),
          )
        })
      },
    )
    request.on('error', reject)
    request.end()
  })
}

/**
 * A `lookup` that answers with the pinned addresses. Node (22+) asks with
 * `{ all: true }` for Happy Eyeballs and then needs the whole list, not a
 * single address; answering with one address fails every connection.
 */
function pinnedLookup(addresses: string[]) {
  const records = addresses.map((address) => ({
    address,
    family: isIP(address),
  }))
  return (
    _hostname: string,
    options: LookupOptions,
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    const family =
      options.family === 4 || options.family === 6 ? options.family : undefined
    const pool = family
      ? records.filter((record) => record.family === family)
      : records
    const first = pool.at(0)
    if (!first) {
      callback(
        Object.assign(new Error('No pinned address for this address family'), {
          code: 'ENOTFOUND',
        }),
        '',
      )
      return
    }
    if (options.all) callback(null, pool)
    else callback(null, first.address, first.family)
  }
}
