import { isIP } from 'node:net'

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
  if (isIP(value) === 4) return isPrivateIPv4(value)
  if (isIP(value) === 6) return isPrivateIPv6(value)
  return (
    value === 'localhost' ||
    value.endsWith('.localhost') ||
    value.endsWith('.local') ||
    value.endsWith('.internal') ||
    !value.includes('.')
  )
}

function isPrivateIPv4(address: string) {
  const [a, b] = address.split('.').map(Number)
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  )
}

function isPrivateIPv6(address: string) {
  const value = address.toLowerCase()
  if (value === '::1') return true
  if (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4) {
    return isPrivateIPv4(value.slice(7))
  }
  // fc00::/7 unique local, fe80::/10 link-local.
  return /^f[cd]/.test(value) || /^fe[89ab]/.test(value)
}

/** Encryption used when none is configured. */
export function defaultSecureFor(host: string): MailSecure {
  return isPrivateMailHost(host) ? 'none' : 'starttls'
}

/** Plain SMTP to a public host would send credentials and mail in clear text. */
export function isInsecureForHost(config: Pick<MailConfig, 'host' | 'secure'>) {
  return config.secure === 'none' && !isPrivateMailHost(config.host)
}
