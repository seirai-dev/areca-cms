/**
 * A readable device, browser and OS from a user agent string, for the
 * Sessions list. Deliberately small: it names the common browsers and
 * systems and says nothing when it is not sure, rather than guessing.
 */
export type DeviceKind = 'desktop' | 'mobile' | 'tablet' | 'unknown'

export type ParsedUserAgent = {
  browser: string | null
  os: string | null
  device: DeviceKind
}

export function parseUserAgent(
  userAgent: string | null | undefined,
): ParsedUserAgent {
  const ua = userAgent?.trim() ?? ''
  if (!ua) return { browser: null, os: null, device: 'unknown' }
  return {
    browser: browserName(ua),
    os: osName(ua),
    device: deviceKind(ua),
  }
}

// Order matters: Edge, Opera and Samsung also say "Chrome", and Chrome says
// "Safari".
function browserName(ua: string): string | null {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge'
  if (/OPR\/|Opera/.test(ua)) return 'Opera'
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet'
  if (/FxiOS\/|Firefox\//.test(ua)) return 'Firefox'
  if (/Chromium\//.test(ua)) return 'Chromium'
  if (/CriOS\/|Chrome\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return null
}

function osName(ua: string): string | null {
  if (/Windows NT/.test(ua)) return 'Windows'
  // iPadOS reports "Macintosh", so the iOS check comes before macOS.
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Android/.test(ua)) return 'Android'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS'
  if (/Linux/.test(ua)) return 'Linux'
  return null
}

function deviceKind(ua: string): DeviceKind {
  if (/iPad|Tablet/.test(ua)) return 'tablet'
  // Android tablets leave "Mobile" out of their user agent.
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'mobile' : 'tablet'
  if (/Mobi|iPhone|iPod/.test(ua)) return 'mobile'
  return 'desktop'
}
