import { isIP } from 'node:net'

import { isPrivateNetworkAddress } from '#/server/http/ip-address'

import type { MailConfig, MailSecure } from './types.ts'

/**
 * True for hosts that never leave the private network: loopback, RFC 1918 and
 * link-local addresses, and single-label or local-only names such as the
 * `mailpit` docker service. Only these may use unencrypted SMTP.
 */
export function isPrivateMailHost(host: string) {
  const value = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
  if (!value) return false
  if (isIP(value)) return isPrivateNetworkAddress(value)
  return (
    value === 'localhost' ||
    value.endsWith('.localhost') ||
    value.endsWith('.local') ||
    value.endsWith('.internal') ||
    !value.includes('.')
  )
}

/** Encryption used when none is configured. */
export function defaultSecureFor(host: string): MailSecure {
  return isPrivateMailHost(host) ? 'none' : 'starttls'
}

/** Plain SMTP to a public host would send credentials and mail in clear text. */
export function isInsecureForHost(config: Pick<MailConfig, 'host' | 'secure'>) {
  return config.secure === 'none' && !isPrivateMailHost(config.host)
}
