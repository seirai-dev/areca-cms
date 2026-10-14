import type { CoffeesEntry } from '../generated/content/areca.gen.ts'
import { formatAltitude, formatDate, formatLabel } from './formatters.ts'

/** Definition list of a coffee's facts with hairline dividers; empty values are omitted. */
export function CoffeeSpecs({ coffee }: { coffee: CoffeesEntry }) {
  const { data } = coffee
  const rows: Array<[string, string | null | undefined]> = [
    ['Origin', [data.origin, data.region].filter(Boolean).join(', ') || null],
    ['Producer', data.producer],
    ['Process', formatLabel(data.process)],
    ['Altitude', formatAltitude(data.altitude)],
    ['Harvest', formatDate(data.harvestDate)],
  ]
  const visible = rows.filter((row): row is [string, string] => Boolean(row[1]))
  if (visible.length === 0) return null
  return (
    <dl className="divide-y divide-line border-y border-line text-sm">
      {visible.map(([term, value]) => (
        <div key={term} className="flex items-baseline justify-between gap-6 py-3.5">
          <dt className="text-muted">{term}</dt>
          <dd className="text-right font-medium text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
