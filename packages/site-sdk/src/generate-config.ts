import type {
  AssetsConfig,
  CollectionConfig,
  Field,
  GlobalConfig,
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
  'group',
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

  const globals = config.globals ?? {}
  const globalKeys = Object.keys(globals).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (globalKeys.length > 0) {
    lines.push('  globals: {')
    for (const key of globalKeys) {
      lines.push(...globalLines(key, globals[key] as GlobalConfig))
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

  lines.push(...fieldsLines(collection.fields))

  lines.push('    },')
  return lines
}

function globalLines(key: string, global: GlobalConfig): string[] {
  const lines = [`    ${propertyKey(key)}: {`]

  if (global.label !== undefined) {
    lines.push(`      label: ${quote(global.label)},`)
  }
  if (global.seo !== undefined) {
    lines.push(`      seo: ${global.seo},`)
  }
  if (global.previewPath !== undefined) {
    lines.push(`      previewPath: ${quote(global.previewPath)},`)
  }

  lines.push(...fieldsLines(global.fields))

  lines.push('    },')
  return lines
}

function fieldsLines(fields: readonly Field[]): string[] {
  if (fields.length === 0) return ['      fields: [],']
  return [
    '      fields: [',
    ...fields.flatMap((field) => fieldLines(field, '        ')),
    '      ],',
  ]
}

function fieldLines(field: Field, indent: string): string[] {
  const entries = fieldEntries(field)
  // The width is that of the object itself: indent and trailing comma are not counted.
  const body = `{ ${entries.map(([k, v]) => `${k}: ${v}`).join(', ')} }`
  if (body.length <= MAX_LINE_WIDTH) {
    return [`${indent}${body},`]
  }

  return [
    `${indent}{`,
    ...entries.map(([k, v]) => `${indent}  ${k}: ${v},`),
    `${indent}},`,
  ]
}

function fieldEntries(field: Field): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  // Every key in FIELD_KEY_ORDER exists on at least one Field variant.
  const values: Partial<Record<(typeof FIELD_KEY_ORDER)[number], string | boolean | readonly string[]>> = field

  for (const key of FIELD_KEY_ORDER) {
    const value = values[key]
    if (value === undefined) continue
    entries.push([propertyKey(key), renderValue(value)])
  }

  return entries
}

function renderValue(value: string | boolean | readonly string[]): string {
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return quote(value)
  return `[${value.map((item) => quote(item)).join(', ')}]`
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
