import type {
  AssetsConfig,
  CollectionConfig,
  Field,
  SiteContentConfig,
} from './types.js'

const MAX_LINE_WIDTH = 80
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const FIELD_KEY_ORDER = [
  'key',
  'label',
  'type',
  'required',
  'options',
  'collection',
  'description',
  'after',
] as const

/**
 * Renders a `SiteContentConfig` as the source of an `areca.config.ts` file:
 * 2-space indent, single quotes, trailing commas, no semicolons. Field objects
 * are printed on one line when they fit within 80 columns, otherwise expanded.
 */
export function generateConfigSource(config: SiteContentConfig): string {
  const lines: string[] = [
    "import { defineSiteContent } from '@areca-cms/site-sdk'",
    '',
    'export default defineSiteContent({',
    `  siteKey: ${quote(config.siteKey)},`,
  ]

  if (config.assets !== undefined) {
    lines.push(...assetsConfigLines(config.assets, '  '))
  }

  const keys = Object.keys(config.collections).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  if (keys.length === 0) {
    lines.push('  collections: {},')
  } else {
    lines.push('  collections: {')
    for (const key of keys) {
      lines.push(...collectionLines(key, config.collections[key] as CollectionConfig))
    }
    lines.push('  },')
  }

  lines.push('})')
  return `${lines.join('\n')}\n`
}

const ASSETS_KEY_ORDER = ['download', 'dir', 'publicPath'] as const

/** The `assets: { ... },` block of an areca.config.ts, indented by `indent`. */
export function assetsConfigLines(
  assets: AssetsConfig,
  indent: string,
): string[] {
  const entries = ASSETS_KEY_ORDER.filter(
    (key) => assets[key] !== undefined,
  ).map((key) => `${indent}  ${key}: ${renderValue(assets[key]!)},`)
  if (entries.length === 0) return [`${indent}assets: {},`]
  return [`${indent}assets: {`, ...entries, `${indent}},`]
}

function collectionLines(key: string, collection: CollectionConfig): string[] {
  const lines = [`    ${propertyKey(key)}: {`, `      route: ${quote(collection.route)},`]

  if (collection.label !== undefined) {
    lines.push(`      label: ${quote(collection.label)},`)
  }

  if (collection.fields.length === 0) {
    lines.push('      fields: [],')
  } else {
    lines.push('      fields: [')
    for (const field of collection.fields) {
      lines.push(...fieldLines(field, '        '))
    }
    lines.push('      ],')
  }

  lines.push('    },')
  return lines
}

function fieldLines(field: Field, indent: string): string[] {
  const entries = fieldEntries(field)
  const inline = `${indent}{ ${entries.map(([k, v]) => `${k}: ${v}`).join(', ')} },`
  if (inline.length <= MAX_LINE_WIDTH) {
    return [inline]
  }

  return [
    `${indent}{`,
    ...entries.map(([k, v]) => `${indent}  ${k}: ${v},`),
    `${indent}},`,
  ]
}

function fieldEntries(field: Field): Array<[string, string]> {
  const entries: Array<[string, string]> = []

  for (const key of FIELD_KEY_ORDER) {
    const value = field[key]
    if (value === undefined) continue
    entries.push([propertyKey(key), renderValue(value)])
  }

  return entries
}

function renderValue(value: string | boolean | string[]): string {
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map((item) => quote(item)).join(', ')}]`
  return quote(value)
}

function propertyKey(key: string): string {
  return IDENTIFIER.test(key) ? key : quote(key)
}

function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `'${escaped}'`
}
