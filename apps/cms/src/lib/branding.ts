/**
 * Whitelabel branding shared by server and client: defaults, the curated font
 * list, and the accent-colour → palette derivation. Pure, no I/O.
 */

export const DEFAULT_APP_NAME = 'Areca'

export const FONTS = {
  // Self-hosted via fontsource; no Google stylesheet needed.
  inter: {
    label: 'Inter',
    family: "'Inter Variable', ui-sans-serif, system-ui, sans-serif",
    google: null,
  },
  'bricolage-grotesque': {
    label: 'Bricolage Grotesque',
    family:
      "'Bricolage Grotesque Variable', ui-sans-serif, system-ui, sans-serif",
    google: null,
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

export const DEFAULT_FONT: FontKey = 'inter'

/** Iris, the built-in accent in light mode (see `iris` in styles.css). */
export const DEFAULT_ACCENT = '#5856d6'

export function isFontKey(value: unknown): value is FontKey {
  return typeof value === 'string' && value in FONTS
}

/** The font entry for a key, falling back to the default for unknown keys. */
export function fontEntry(font: string | null | undefined) {
  return isFontKey(font) ? FONTS[font] : FONTS[DEFAULT_FONT]
}

export function fontStylesheetUrl(font: FontKey | string): string | null {
  const google = fontEntry(font).google
  return google
    ? `https://fonts.googleapis.com/css2?family=${google}&display=swap`
    : null
}

/**
 * One-click looks. Branding is meant to take seconds: pick a preset, optionally
 * nudge the accent, upload a logo. `accent: null` means the built-in palette:
 * iris (#5856D6 light / #7D7AFF dark) with Inter.
 */
export const BRAND_PRESETS = [
  { id: 'areca', label: 'Areca', accent: null, font: 'inter' },
  { id: 'slate', label: 'Slate', accent: '#4f6b8a', font: 'inter' },
  { id: 'indigo', label: 'Indigo', accent: '#5b5bd6', font: 'dm-sans' },
  { id: 'plum', label: 'Plum', accent: '#9b4b8f', font: 'bricolage-grotesque' },
  { id: 'amber', label: 'Amber', accent: '#b5731f', font: 'figtree' },
  { id: 'ocean', label: 'Ocean', accent: '#1f8a8a', font: 'manrope' },
] as const satisfies ReadonlyArray<{
  id: string
  label: string
  accent: string | null
  font: FontKey
}>

export type BrandPresetId = (typeof BRAND_PRESETS)[number]['id']

/** The preset matching an accent/font pair, or null when the pair is custom. */
export function matchPreset(accent: string | null, font: FontKey) {
  const hex = accent ? normalizeHex(accent) : null
  return (
    BRAND_PRESETS.find(
      (preset) => preset.accent === hex && preset.font === font,
    ) ?? null
  )
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

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

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

/** Keep derived scales inside a range that still renders on sRGB screens. */
const MAX_PEAK_CHROMA = 0.16
const MIN_PEAK_CHROMA = 0.04

function fmt(value: number, digits = 4) {
  return Number(value.toFixed(digits)).toString()
}

/**
 * The accent colour in the tones the semantic accent tokens need, per mode.
 * Light mode keeps the picked lightness; dark mode lifts it so the accent
 * still reads on near-black (iris #5856D6 → #7D7AFF is the reference pair).
 */
function accentTones(base: Oklch, mode: AccentMode) {
  const peak = Math.min(MAX_PEAK_CHROMA, Math.max(MIN_PEAK_CHROMA, base.c))
  const clampL = (l: number) => Math.min(0.97, Math.max(0.12, l))
  const tone = (l: number, chromaFactor = 1, alpha?: number) =>
    `oklch(${fmt(clampL(l) * 100, 2)}% ${fmt(peak * chromaFactor)} ${fmt(
      base.h,
      2,
    )}${alpha === undefined ? '' : ` / ${alpha}`})`

  if (mode === 'dark') {
    const l = Math.min(0.85, Math.max(base.l + 0.1, 0.6))
    return {
      accent: tone(l),
      hover: tone(l + 0.07, 0.95),
      soft: tone(l, 1, 0.16),
      text: tone(Math.max(l + 0.12, 0.76), 0.8),
      icon: tone(Math.max(l + 0.04, 0.66), 0.95),
      lightness: l,
    }
  }
  return {
    accent: tone(base.l),
    hover: tone(base.l - 0.06, 1.02),
    soft: tone(base.l, 1, 0.12),
    text: tone(Math.min(base.l, 0.5), 0.95),
    icon: tone(base.l),
    lightness: base.l,
  }
}

export type AccentMode = 'light' | 'dark'

/** Black or white, whichever reads better on the accent. */
function accentTextColor(hex: string): string {
  const onWhite = contrastRatio('#ffffff', hex) ?? 1
  const onInk = contrastRatio('#111111', hex) ?? 1
  return onInk >= onWhite ? '#111111' : '#ffffff'
}

/**
 * CSS custom properties that re-tint the accent tokens from one brand colour
 * (brief §4.1). Instance branding drives the accent (selection, focus, links,
 * switches, progress, "Ready"), never the ink primary button. Returns `null`
 * when the hex is invalid so callers fall back to the stylesheet defaults.
 */
export function accentVariables(
  hex: string,
  mode: AccentMode = 'light',
): Record<string, string> | null {
  const base = hexToOklch(hex)
  if (!base) return null
  const tones = accentTones(base, mode)
  return {
    '--color-accent': tones.accent,
    '--color-accent-hover': tones.hover,
    '--color-accent-soft': tones.soft,
    '--color-accent-text': tones.text,
    '--color-accent-contrast':
      mode === 'dark' && tones.lightness > 0.72
        ? '#111111'
        : accentTextColor(hex),
    '--color-text-accent': tones.text,
    '--color-icon-accent': tones.icon,
    '--color-border-focus': tones.accent,
    '--color-status-info': tones.accent,
    '--color-status-info-bg': tones.soft,
  }
}

const ADVANCED_COLOR_VARIABLES: Record<BrandColorKey, readonly string[]> = {
  background: ['--color-background-default'],
  foreground: ['--color-text-primary'],
  surface: ['--color-background-surface', '--color-background-elevated'],
  surfaceForeground: ['--color-text-primary'],
  muted: ['--color-background-subtle'],
  mutedForeground: ['--color-text-muted'],
  accent: ['--color-surface-state-hover'],
  accentForeground: ['--color-text-primary'],
  border: ['--color-border-default'],
  input: ['--color-border-default'],
  primary: ['--color-action-primary'],
  primaryForeground: ['--color-action-primary-text'],
  secondary: ['--color-action-secondary'],
  secondaryForeground: ['--color-text-secondary'],
  link: ['--color-text-accent'],
  ring: ['--color-border-focus'],
  sidebar: ['--color-sidebar'],
  sidebarForeground: ['--color-text-primary'],
  sidebarPrimary: ['--color-accent'],
  sidebarPrimaryForeground: ['--color-accent-contrast'],
  sidebarAccent: ['--color-surface-state-hover'],
  sidebarAccentForeground: ['--color-text-primary'],
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
 * Inline stylesheet applied in the document head. Accent and advanced colours
 * are emitted per mode: `:root:not(.dark)` for light, `html.dark` for dark
 * (matching the specificity of the dark block in `styles.css`).
 */
export function brandingCss(
  view: Pick<
    BrandingView,
    'accentColor' | 'advancedColorsEnabled' | 'advancedColors' | 'font'
  >,
) {
  const rules: string[] = []
  if (view.accentColor) {
    const light = accentVariables(view.accentColor, 'light')
    const dark = accentVariables(view.accentColor, 'dark')
    if (light) rules.push(cssBlock(':root:not(.dark)', light))
    if (dark) rules.push(cssBlock('html.dark', dark))
  }
  if (view.advancedColorsEnabled) {
    const lightRule = cssBlock(
      ':root:not(.dark)',
      advancedVariables(view.advancedColors.light),
    )
    const darkRule = cssBlock(
      'html.dark',
      advancedVariables(view.advancedColors.dark),
    )
    if (lightRule) rules.push(lightRule)
    if (darkRule) rules.push(darkRule)
  }
  if (isFontKey(view.font) && view.font !== DEFAULT_FONT) {
    rules.push(`:root{--font-sans:${FONTS[view.font].family}}`)
  }
  return rules.join('\n')
}

/**
 * Style object for previewing an accent inside one element. The semantic
 * tokens are declared on `:root` / `html.dark`, so a scoped preview has to
 * redeclare the accent tokens for the mode being previewed.
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
    const vars = accentVariables(view.accentColor, mode)
    if (vars) Object.assign(style, vars)
  }
  if (view.advancedColorsEnabled) {
    Object.assign(style, advancedVariables(view.advancedColors[mode]))
  }
  return style
}
