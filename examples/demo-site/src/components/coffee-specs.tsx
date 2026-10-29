import type { ReactNode } from 'react'
import type { CoffeesEntry } from '../generated/content/areca.gen.ts'
import { m } from '#/paraglide/messages'
import { useField } from '../lib/visual-markers.tsx'
import { formatAltitude, formatDate, processLabel } from './formatters.ts'
import { JoinedParts } from './ui.tsx'

/** Definition list of a coffee's facts with hairline dividers; empty values are omitted. */
export function CoffeeSpecs({ coffee }: { coffee: CoffeesEntry }) {
  const { data } = coffee
  const field = useField()
  const rows: Array<{ term: string; show: boolean; value: ReactNode }> = [
    {
      term: m.spec_origin(),
      show: Boolean(data.origin || data.region),
      value: (
        <JoinedParts
          separator=", "
          parts={[
            { value: data.origin, marker: field('origin') },
            { value: data.region, marker: field('region') },
          ]}
        />
      ),
    },
    {
      term: m.spec_producer(),
      show: Boolean(data.producer),
      value: <span {...field('producer')}>{data.producer}</span>,
    },
    {
      term: m.spec_process(),
      show: Boolean(processLabel(data.process)),
      value: <span {...field('process')}>{processLabel(data.process)}</span>,
    },
    {
      term: m.spec_altitude(),
      show: Boolean(formatAltitude(data.altitude)),
      value: <span {...field('altitude')}>{formatAltitude(data.altitude)}</span>,
    },
    {
      term: m.spec_harvest(),
      show: Boolean(formatDate(data.harvestDate)),
      value: <span {...field('harvestDate')}>{formatDate(data.harvestDate)}</span>,
    },
  ]
  const visible = rows.filter((row) => row.show)
  if (visible.length === 0) return null
  return (
    <dl className="divide-y divide-line border-y border-line text-sm">
      {visible.map((row) => (
        <div key={row.term} className="flex items-baseline justify-between gap-6 py-3.5">
          <dt className="text-muted">{row.term}</dt>
          <dd className="text-right font-medium text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}
