import { isIP } from 'node:net'

function parseIPv4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) =>
    /^\d{1,3}$/.test(part) ? Number(part) : Number.NaN,
  )
  return octets.every((n) => n >= 0 && n <= 255) ? octets : null
}

function isPublicIPv4(octets: number[]): boolean {
  const [a, b, c] = octets as [number, number, number]
  if (a === 0 || a === 10 || a === 127) return false // 0/8, 10/8, 127/8
  if (a === 100 && b >= 64 && b <= 127) return false // 100.64/10
  if (a === 169 && b === 254) return false // 169.254/16
  if (a === 172 && b >= 16 && b <= 31) return false // 172.16/12
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false // 192.0.0/24, 192.0.2/24
  if (a === 192 && b === 168) return false // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return false // 198.18/15
  if (a === 198 && b === 51 && c === 100) return false // 198.51.100/24
  if (a === 203 && b === 0 && c === 113) return false // 203.0.113/24
  if (a >= 224) return false // multicast 224/4 and reserved 240/4 (incl. broadcast)
  return true
}

/** Loopback, RFC 1918 and link-local: hosts on this machine or its LAN. */
function isPrivateNetworkIPv4(octets: number[]): boolean {
  const [a, b] = octets as [number, number]
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  )
}

function parseHextet(part: string): number {
  return /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : Number.NaN
}

/** Expands an IPv6 literal into eight 16-bit groups. Returns null when malformed. */
function parseIPv6(address: string): number[] | null {
  let text = address.toLowerCase()
  const zone = text.indexOf('%')
  if (zone >= 0) text = text.slice(0, zone)

  const lastColon = text.lastIndexOf(':')
  const tail = text.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail)
    if (!v4) return null
    const high = (v4[0] << 8) | v4[1]
    const low = (v4[2] << 8) | v4[3]
    text = `${text.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`
  }

  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  let groups: string[]
  if (halves.length === 2) {
    const rest = halves[1] ? halves[1].split(':') : []
    const missing = 8 - head.length - rest.length
    if (missing < 1) return null
    groups = [...head, ...Array<string>(missing).fill('0'), ...rest]
  } else {
    groups = head
  }
  if (groups.length !== 8) return null
  const numbers = groups.map(parseHextet)
  return numbers.some((n) => Number.isNaN(n)) ? null : numbers
}

function embeddedIPv4(high: number, low: number): number[] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff]
}

/** The IPv4 address in an IPv4-mapped ::ffff:a.b.c.d literal, or null. */
function mappedIPv4(groups: number[]): number[] | null {
  return [0, 1, 2, 3, 4].every((i) => groups[i] === 0) && groups[5] === 0xffff
    ? embeddedIPv4(groups[6], groups[7])
    : null
}

function isPublicIPv6(groups: number[]): boolean {
  const g = (index: number) => groups[index]

  const mapped = mappedIPv4(groups)
  if (mapped) return isPublicIPv4(mapped)
  // IPv4-compatible ::a.b.c.d (deprecated) and the unspecified / loopback addresses
  if (groups.slice(0, 6).every((n) => n === 0)) return false
  // NAT64 well-known prefix 64:ff9b::/96 carries an IPv4 address in the low 32 bits
  if (
    g(0) === 0x64 &&
    g(1) === 0xff9b &&
    [2, 3, 4, 5].every((i) => g(i) === 0)
  ) {
    return isPublicIPv4(embeddedIPv4(g(6), g(7)))
  }
  // 6to4 2002::/16 embeds an IPv4 address in the next 32 bits
  if (g(0) === 0x2002) {
    return isPublicIPv4(embeddedIPv4(g(1), g(2)))
  }
  // Only 2000::/3 is globally routable unicast; everything else is refused.
  if ((g(0) & 0xe000) !== 0x2000) return false
  // Documentation 2001:db8::/32
  if (g(0) === 0x2001 && g(1) === 0x0db8) return false
  // Teredo 2001:0::/32 (obfuscated embedded addresses; refused outright)
  if (g(0) === 0x2001 && g(1) === 0x0000) return false
  return true
}

function isPrivateNetworkIPv6(groups: number[]): boolean {
  const mapped = mappedIPv4(groups)
  if (mapped) return isPrivateNetworkIPv4(mapped)
  if (groups.slice(0, 7).every((n) => n === 0) && groups[7] === 1) return true // ::1
  if ((groups[0] & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  return (groups[0] & 0xffc0) === 0xfe80 // fe80::/10 link-local
}

/**
 * True only for addresses on the public internet. Literal non-IP strings return
 * false. IPv4-mapped, NAT64 and 6to4 addresses are judged by their embedded IPv4.
 */
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) {
    const octets = parseIPv4(ip)
    return octets ? isPublicIPv4(octets) : false
  }
  if (version === 6) {
    const groups = parseIPv6(ip)
    return groups ? isPublicIPv6(groups) : false
  }
  return false
}

/**
 * True for loopback, RFC 1918, link-local and unique-local addresses (and their
 * IPv4-mapped forms): hosts that never leave the private network. Non-IP
 * strings return false.
 */
export function isPrivateNetworkAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) {
    const octets = parseIPv4(ip)
    return octets ? isPrivateNetworkIPv4(octets) : false
  }
  if (version === 6) {
    const groups = parseIPv6(ip)
    return groups ? isPrivateNetworkIPv6(groups) : false
  }
  return false
}
