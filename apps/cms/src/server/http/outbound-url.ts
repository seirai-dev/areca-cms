import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

import { AppError } from './app-error'
import { isPublicAddress } from './ip-address'

export type ResolveHost = (hostname: string) => Promise<string[]>

export class UnsafeOutboundUrlError extends AppError {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeOutboundUrlError'
  }
}

export const resolveHost: ResolveHost = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.map((record) => record.address)
}

export function assertSecureServiceUrl(
  rawUrl: string,
  allowInsecureHttp = false,
) {
  const url = new URL(rawUrl)
  if (url.username || url.password) {
    throw new UnsafeOutboundUrlError('Service URL must not contain credentials')
  }
  if (url.protocol === 'https:') return url
  if (
    url.protocol === 'http:' &&
    (allowInsecureHttp || isLocalHostname(url.hostname))
  ) {
    return url
  }
  throw new UnsafeOutboundUrlError('Service URL must use HTTPS')
}

export async function assertSafeHealthCheckUrl(
  rawUrl: string,
  options: {
    resolve?: ResolveHost
    allowPrivateNetwork?: boolean
    allowInsecureHttp?: boolean
  } = {},
) {
  return (await resolveSafeHealthCheckUrl(rawUrl, options)).url
}

export async function resolveSafeHealthCheckUrl(
  rawUrl: string,
  options: {
    resolve?: ResolveHost
    allowPrivateNetwork?: boolean
    allowInsecureHttp?: boolean
  } = {},
) {
  const url = assertSecureServiceUrl(rawUrl, options.allowInsecureHttp)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeOutboundUrlError('Unsupported health-check protocol')
  }
  if (options.allowPrivateNetwork) return { url, addresses: [] }

  const hostname = unbracketHostname(url.hostname)
  const addresses = isIP(hostname)
    ? [hostname]
    : await (options.resolve ?? resolveHost)(hostname)
  if (
    addresses.length === 0 ||
    addresses.some((address) => !isPublicAddress(address))
  ) {
    throw new UnsafeOutboundUrlError(
      'Health-check URL resolves to a private or reserved address',
    )
  }
  return { url, addresses }
}

function isLocalHostname(hostname: string) {
  const normalized = unbracketHostname(hostname)
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1'
  )
}

function unbracketHostname(hostname: string) {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}
