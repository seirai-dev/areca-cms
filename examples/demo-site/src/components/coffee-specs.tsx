import type { CoffeesEntry } from '../generated/content/areca.gen.ts'
import { m } from '#/paraglide/messages'
import { formatAltitude, formatDate, processLabel } from './formatters.ts'

/** Definition list of a coffee's facts with hairline dividers; empty values are omitted. */
export function CoffeeSpecs({ coffee }: { coffee: CoffeesEntry }) {
  const { data } = coffee
  const rows: Array<[string, string | null | undefined]> = [
    [m.spec_origin(), [data.origin, data.region].filter(Boolean).join(', ') || null],
    [m.spec_producer(), data.producer],
    [m.spec_process(), processLabel(data.process)],
    [m.spec_altitude(), formatAltitude(data.altitude)],
    [m.spec_harvest(), formatDate(data.harvestDate)],
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
