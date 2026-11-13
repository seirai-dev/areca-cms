import type { Plugin } from 'vite'

/** Weights the app never renders (`weight="thin"`, `weight="light"`). */
const UNUSED_WEIGHTS = new Set(['thin', 'light'])

const ICON_DEFS =
  /@phosphor-icons[\\/]react[\\/]dist[\\/]defs[\\/][^\\/]+\.es\.js$/

const WEIGHT_ENTRY = /\n {2}\[\n {4}"(\w+)",/g

/**
 * Removes unused weights from one Phosphor icon definition module. Each one is
 * a generated `new Map([["bold", <svg parts>], ["duotone", …], …])`, one entry
 * per weight in a fixed layout; anything else is returned unchanged.
 */
export function stripIconWeights(code: string) {
  const entries = [...code.matchAll(WEIGHT_ENTRY)]
  const end = code.lastIndexOf('\n]);')
  if (entries.length === 0 || end === -1) return code
  let result = ''
  let cursor = 0
  entries.forEach((entry, index) => {
    const start = entry.index
    const next = entries[index + 1]?.index ?? end
    result += code.slice(cursor, start)
    if (!UNUSED_WEIGHTS.has(entry[1])) result += code.slice(start, next)
    cursor = next
  })
  return result + code.slice(cursor)
}

export function phosphorWeights(): Plugin {
  return {
    name: 'areca-phosphor-weights',
    apply: 'build',
    transform: {
      filter: { id: ICON_DEFS },
      handler(code) {
        const stripped = stripIconWeights(code)
        return stripped === code ? null : { code: stripped, map: null }
      },
    },
  }
}
