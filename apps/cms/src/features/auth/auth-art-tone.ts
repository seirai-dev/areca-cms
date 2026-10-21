/** The built-in accent (iris) when branding has none. */
const DEFAULT_ACCENT = '#5856d6'

export type AccentTone = 'bright' | 'normal' | 'deep'

/**
 * How light the accent is. Very light accents (yellow, mint) need less colour
 * behind white text in dark mode; very dark ones (navy) need more colour in
 * light mode so the art does not turn grey. Unparseable values count as normal.
 */
export function accentTone(accent: string | null | undefined): AccentTone {
  const luminance = relativeLuminance(accent ?? DEFAULT_ACCENT)
  if (luminance === null) return 'normal'
  if (luminance > 0.45) return 'bright'
  if (luminance < 0.035) return 'deep'
  return 'normal'
}

/** WCAG relative luminance of a #rgb / #rrggbb colour, or null. */
export function relativeLuminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!match?.[1]) return null
  const digits =
    match[1].length === 3
      ? match[1]
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : match[1]
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = parseInt(digits.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
