/**
 * Whitelabel branding shared by server and client: defaults, the curated font
 * list, and the accent-colour → palette derivation. Pure, no I/O.
 */

export const DEFAULT_APP_NAME = 'Areca'

export const FONTS = {
  'bricolage-grotesque': {
    label: 'Bricolage Grotesque',
    family:
      "'Bricolage Grotesque', ui-sans-serif, system-ui, -apple-system, sans-serif",
    google: 'Bricolage+Grotesque:opsz,wght@12..96,300..800',
  },
  inter: {
    label: 'Inter',
    family: "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif",
    google: 'Inter:opsz,wght@14..32,300..800',
  },
  'dm-sans': {
    label: 'DM Sans',
    family: "'DM Sans', ui-sans-serif, system-ui, -apple-system, sans-serif",
    google: 'DM+Sans:opsz,wght@9..40,300..800',
  },
  manrope: {
    label: 'Manrope',
    family: "'Manrope', ui-sans-serif, system-ui, -apple-system, sans-serif",
    google: 'Manrope:wght@300..800',
  },
  figtree: {
    label: 'Figtree',
    family: "'Figtree', ui-sans-serif, system-ui, -apple-system, sans-serif",
    google: 'Figtree:wght@300..900',
  },
  'ibm-plex-sans': {
    label: 'IBM Plex Sans',
    family:
      "'IBM Plex Sans', ui-sans-serif, system-ui, -apple-system, sans-serif",
    google: 'IBM+Plex+Sans:wght@300;400;500;600;700',
  },
  'source-sans-3': {
    label: 'Source Sans 3',
    family:
      "'Source Sans 3', ui-sans-serif, system-ui, -apple-system, sans-serif",
    google: 'Source+Sans+3:wght@300..800',
  },
  'work-sans': {
    label: 'Work Sans',
    family: "'Work Sans', ui-sans-serif, system-ui, -apple-system, sans-serif",
    google: 'Work+Sans:wght@300..800',
  },
  'space-grotesk': {
    label: 'Space Grotesk',
    family:
      "'Space Grotesk', ui-sans-serif, system-ui, -apple-system, sans-serif",
    google: 'Space+Grotesk:wght@300..700',
  },
  'nunito-sans': {
    label: 'Nunito Sans',
    family:
      "'Nunito Sans', ui-sans-serif, system-ui, -apple-system, sans-serif",
    google: 'Nunito+Sans:opsz,wght@6..12,300..800',
  },
  system: {
    label: 'System default',
    family:
      "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    google: null,
  },
} as const

export type FontKey = keyof typeof FONTS

export const FONT_KEYS = Object.keys(FONTS) as FontKey[]

export const DEFAULT_FONT: FontKey = 'bricolage-grotesque'

export function isFontKey(value: unknown): value is FontKey {
  return typeof value === 'string' && value in FONTS
}

export function fontStylesheetUrl(font: FontKey): string | null {
  const google = FONTS[font].google
  return google
    ? `https://fonts.googleapis.com/css2?family=${google}&display=swap`
    : null
}

export const BRAND_COLOR_KEYS = [
  'background',
  'foreground',
  'surface',
  'surfaceForeground',
  'muted',
  'mutedForeground',
  'accent',
  'accentForeground',
  'border',
  'input',
  'primary',
  'primaryForeground',
  'secondary',
  'secondaryForeground',
  'link',
  'ring',
  'sidebar',
  'sidebarForeground',
  'sidebarPrimary',
  'sidebarPrimaryForeground',
  'sidebarAccent',
  'sidebarAccentForeground',
] as const

export type BrandColorKey = (typeof BRAND_COLOR_KEYS)[number]
export type BrandColorPalette = Partial<Record<BrandColorKey, string>>
export type AdvancedBrandColors = {
  light: BrandColorPalette
  dark: BrandColorPalette
}

export const EMPTY_ADVANCED_COLORS: AdvancedBrandColors = {
  light: {},
  dark: {},
}

/** What the client needs to render the brand. Image URLs are site-relative. */
export type BrandingView = {
  appName: string
  logoUrl: string | null
  faviconUrl: string | null
  faviconMime: string | null
  accentColor: string | null
  advancedColorsEnabled: boolean
  advancedColors: AdvancedBrandColors
  font: FontKey
  emailFromName: string | null
  /** True when any field differs from the built-in defaults. */
  customized: boolean
}

export const DEFAULT_BRANDING: BrandingView = {
  appName: DEFAULT_APP_NAME,
  logoUrl: null,
  faviconUrl: null,
  faviconMime: null,
  accentColor: null,
  advancedColorsEnabled: false,
  advancedColors: EMPTY_ADVANCED_COLORS,
  font: DEFAULT_FONT,
  emailFromName: null,
  customized: false,
}

export const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export function normalizeHex(value: string): string | null {
  const trimmed = value.trim()
  if (!HEX_COLOR_RE.test(trimmed)) return null
  const hex = trimmed.slice(1).toLowerCase()
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
  }
  return `#${hex}`
}

export function normalizeAdvancedColors(value: unknown): AdvancedBrandColors {
  const input =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

  function normalizePalette(palette: unknown): BrandColorPalette {
    if (!palette || typeof palette !== 'object') return {}
    const source = palette as Record<string, unknown>
    const normalized: BrandColorPalette = {}
    for (const key of BRAND_COLOR_KEYS) {
      const raw = source[key]
      if (typeof raw !== 'string') continue
      const hex = normalizeHex(raw)
      if (hex) normalized[key] = hex
    }
    return normalized
  }

  return {
    light: normalizePalette(input.light),
    dark: normalizePalette(input.dark),
  }
}

export function hasAdvancedColors(colors: AdvancedBrandColors) {
  return (
    Object.keys(colors.light).length > 0 || Object.keys(colors.dark).length > 0
  )
}

function hexLuminance(hex: string) {
  const normalized = normalizeHex(hex)
  if (!normalized) return null
  const channels = [1, 3, 5].map((start) => {
    const channel = parseInt(normalized.slice(start, start + 2), 16) / 255
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = hexLuminance(foreground)
  const backgroundLuminance = hexLuminance(background)
  if (foregroundLuminance === null || backgroundLuminance === null) return null
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

// ---------------------------------------------------------------------------
// Colour maths. sRGB hex → OKLCH, then a 50…950 scale that mirrors the shape
// of the built-in palette (fixed lightness steps, chroma peaking at 500).

type Oklch = { l: number; c: number; h: number }

function srgbToLinear(channel: number) {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function hexToOklch(hex: string): Oklch | null {
  const normalized = normalizeHex(hex)
  if (!normalized) return null
  const r = srgbToLinear(parseInt(normalized.slice(1, 3), 16))
  const g = srgbToLinear(parseInt(normalized.slice(3, 5), 16))
  const b = srgbToLinear(parseInt(normalized.slice(5, 7), 16))

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  const c = Math.hypot(A, B)
  let h = (Math.atan2(B, A) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: L, c, h: c < 1e-4 ? 0 : h }
}

/** Lightness of each step, 50 → 950, taken from the built-in clay scale. */
const STEP_LIGHTNESS = [
  0.1569, 0.2129, 0.3148, 0.4112, 0.5032, 0.5883, 0.6735, 0.7557, 0.8376,
  0.9204, 0.9592,
] as const

/** Chroma relative to the 500 step, from the built-in fern scale. */
const STEP_CHROMA = [
  0.15, 0.27, 0.45, 0.65, 0.85, 1, 0.83, 0.58, 0.4, 0.2, 0.12,
] as const

export const SCALE_STEPS = [
  50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950,
] as const

/** Keep derived scales inside a range that still renders on sRGB screens. */
const MAX_PEAK_CHROMA = 0.16
const MIN_PEAK_CHROMA = 0.04

function fmt(value: number, digits = 4) {
  return Number(value.toFixed(digits)).toString()
}

export function buildScale(
  base: Oklch,
  opts: { chromaFactor?: number } = {},
): Record<(typeof SCALE_STEPS)[number], string> {
  const peak =
    Math.min(MAX_PEAK_CHROMA, Math.max(MIN_PEAK_CHROMA, base.c)) *
    (opts.chromaFactor ?? 1)
  const out = {} as Record<(typeof SCALE_STEPS)[number], string>
  SCALE_STEPS.forEach((step, index) => {
    const l = STEP_LIGHTNESS[index]
    const c = peak * STEP_CHROMA[index]
    out[step] = `oklch(${fmt(l * 100, 2)}% ${fmt(c)} ${fmt(base.h, 2)})`
  })
  return out
}

/**
 * CSS custom properties that re-tint the brand scales from one accent colour.
 * `clay` (primary) and `fern` (accent) take the full chroma; `moss`
 * (secondary) is a softer tint of the same hue. Returns `null` when the hex is
 * invalid so callers fall back to the stylesheet defaults.
 */
export function accentVariables(hex: string): Record<string, string> | null {
  const base = hexToOklch(hex)
  if (!base) return null
  const strong = buildScale(base)
  const soft = buildScale(base, { chromaFactor: 0.6 })
  const vars: Record<string, string> = {}
  for (const step of SCALE_STEPS) {
    vars[`--color-clay-${step}`] = strong[step]
    vars[`--color-fern-${step}`] = strong[step]
    vars[`--color-moss-${step}`] = soft[step]
  }
  // Success stays green regardless of the accent so status colours keep
  // their meaning.
  vars['--success'] = 'oklab(45.54% -0.069 0.05)'
  return vars
}

const DARK_SUCCESS = 'oklab(72.51% -0.087 0.06)'

const ADVANCED_COLOR_VARIABLES: Record<BrandColorKey, readonly string[]> = {
  background: ['--background'],
  foreground: ['--foreground'],
  surface: ['--card', '--popover'],
  surfaceForeground: ['--card-foreground', '--popover-foreground'],
  muted: ['--muted'],
  mutedForeground: ['--muted-foreground'],
  accent: ['--accent'],
  accentForeground: ['--accent-foreground'],
  border: ['--border'],
  input: ['--input'],
  primary: ['--primary'],
  primaryForeground: ['--primary-foreground'],
  secondary: ['--secondary'],
  secondaryForeground: ['--secondary-foreground'],
  link: ['--link'],
  ring: ['--ring'],
  sidebar: ['--sidebar'],
  sidebarForeground: ['--sidebar-foreground'],
  sidebarPrimary: ['--sidebar-primary'],
  sidebarPrimaryForeground: ['--sidebar-primary-foreground'],
  sidebarAccent: ['--sidebar-accent'],
  sidebarAccentForeground: ['--sidebar-accent-foreground'],
}

function advancedVariables(palette: BrandColorPalette) {
  const variables: Record<string, string> = {}
  for (const key of BRAND_COLOR_KEYS) {
    const value = palette[key]
    if (!value) continue
    for (const variable of ADVANCED_COLOR_VARIABLES[key]) {
      variables[variable] = value
    }
  }
  return variables
}

function cssBlock(selector: string, variables: Record<string, string>) {
  const body = Object.entries(variables)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
  return body ? `${selector}{${body}}` : ''
}

/**
 * Inline stylesheet applied in the document head. Both the light `:root`
 * block and the `.dark` block reference the same scale variables, so a single
 * override covers both modes.
 */
export function brandingCss(
  view: Pick<
    BrandingView,
    'accentColor' | 'advancedColorsEnabled' | 'advancedColors' | 'font'
  >,
) {
  const rules: string[] = []
  if (view.accentColor) {
    const vars = accentVariables(view.accentColor)
    if (vars) {
      rules.push(cssBlock(':root', vars))
      rules.push(`.dark{--success:${DARK_SUCCESS}}`)
    }
  }
  if (view.advancedColorsEnabled) {
    const lightRule = cssBlock(
      ':root:not(.dark)',
      advancedVariables(view.advancedColors.light),
    )
    const darkRule = cssBlock(
      '.dark',
      advancedVariables(view.advancedColors.dark),
    )
    if (lightRule) rules.push(lightRule)
    if (darkRule) rules.push(darkRule)
  }
  if (view.font !== DEFAULT_FONT) {
    rules.push(`:root{--font-sans:${FONTS[view.font].family}}`)
  }
  return rules.join('\n')
}

/**
 * Style object for previewing an accent inside one element. The semantic
 * tokens are computed on `:root`, so a scoped preview has to redeclare them
 * (light-mode mapping) next to the scale overrides.
 */
export function brandingPreviewStyle(
  view: Pick<
    BrandingView,
    'accentColor' | 'advancedColorsEnabled' | 'advancedColors'
  >,
  mode: keyof AdvancedBrandColors = 'light',
): Record<string, string> {
  const style: Record<string, string> = {}
  if (view.accentColor) {
    const vars = accentVariables(view.accentColor)
    if (vars) {
      Object.assign(style, vars, {
        '--primary':
          mode === 'dark' ? 'var(--color-clay-600)' : 'var(--color-clay-400)',
        '--secondary':
          mode === 'dark' ? 'var(--color-moss-200)' : 'var(--color-moss-900)',
        '--secondary-foreground':
          mode === 'dark' ? 'var(--color-moss-900)' : 'var(--color-fern-200)',
        '--link':
          mode === 'dark' ? 'var(--color-fern-600)' : 'var(--color-fern-300)',
        '--ring': 'var(--color-fern-500)',
        '--sidebar-primary':
          mode === 'dark' ? 'var(--color-fern-600)' : 'var(--color-fern-300)',
        '--sidebar-accent':
          mode === 'dark' ? 'var(--color-moss-100)' : 'var(--color-moss-900)',
      })
    }
  }
  if (view.advancedColorsEnabled) {
    Object.assign(style, advancedVariables(view.advancedColors[mode]))
  }
  return style
}
