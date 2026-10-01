import * as React from 'react'
import { Globe } from '@phosphor-icons/react'

import { browserTimezone, timezoneOptions } from '#/lib/content/utils'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { ClockIcon } from '#/components/ui/status-pill'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

import { presetInstant, wallTime, zonedToInstant } from './schedule-time'
import type { SchedulePreset } from './schedule-time'

/**
 * "Schedule going live" (brief §3.5): quick chips, a date and a time, the
 * time zone line ("Europe/Amsterdam · Change"), Schedule. The `schedule-at`
 * datetime-local mirrors the date and time for tests and assistive tech.
 */
export function ScheduleForm({
  initialAt,
  initialTimeZone,
  pending,
  onSubmit,
  onCancel,
}: {
  initialAt?: Date | null
  initialTimeZone?: string | null
  pending: boolean
  onSubmit: (at: Date, timeZone: string) => void
  onCancel: () => void
}) {
  const [timeZone, setTimeZone] = React.useState(
    () => initialTimeZone || browserTimezone(),
  )
  const [changingZone, setChangingZone] = React.useState(false)
  const start = React.useMemo(
    () =>
      wallTime(
        initialAt && initialAt.getTime() > Date.now()
          ? initialAt
          : presetInstant('tomorrow', timeZone),
        timeZone,
      ),
    // Only the first render picks the starting point.
    [],
  )
  const [date, setDate] = React.useState(start.date)
  const [time, setTime] = React.useState(start.time)
  const [touched, setTouched] = React.useState(false)

  const instant = zonedToInstant(date, time, timeZone)
  const past = instant ? instant.getTime() <= Date.now() : false
  const invalid = !instant || past

  function applyPreset(preset: SchedulePreset) {
    const at = presetInstant(preset, timeZone)
    const wall = wallTime(at, timeZone)
    setDate(wall.date)
    setTime(wall.time)
  }

  const activePreset = (['tomorrow', 'monday', 'hour'] as const).find(
    (preset) => {
      const wall = wallTime(presetInstant(preset, timeZone), timeZone)
      return wall.date === date && wall.time === time
    },
  )

  const summary = instant
    ? new Intl.DateTimeFormat(getLocale(), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
      }).format(instant)
    : null

  const zones = timezoneOptions().includes(timeZone)
    ? timezoneOptions()
    : [timeZone, ...timezoneOptions()]

  return (
    <form
      className="grid gap-4"
      data-testid="schedule-form"
      onSubmit={(event) => {
        event.preventDefault()
        setTouched(true)
        if (instant && !past) onSubmit(instant, timeZone)
      }}
    >
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label={m.editor_schedule_quick()}
      >
        {(
          [
            ['tomorrow', m.editor_schedule_tomorrow()],
            ['monday', m.editor_schedule_monday()],
            ['hour', m.editor_schedule_hour()],
          ] as const
        ).map(([preset, label]) => (
          <button
            key={preset}
            type="button"
            aria-pressed={activePreset === preset}
            data-testid={`schedule-preset-${preset}`}
            onClick={() => applyPreset(preset)}
            className={cn(
              'h-7 rounded-full border px-2.5 text-[12.5px] font-medium transition-colors duration-150',
              'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
              activePreset === preset
                ? 'border-accent bg-accent-soft text-accent-text'
                : 'border-border-strong bg-background-surface text-text-primary hover:bg-surface-state-hover',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="schedule-date">{m.editor_schedule_date()}</Label>
          <Input
            id="schedule-date"
            type="date"
            value={date}
            aria-invalid={touched && invalid ? true : undefined}
            onChange={(event) => setDate(event.target.value)}
            data-testid="schedule-date"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="schedule-time">{m.editor_schedule_time()}</Label>
          <Input
            id="schedule-time"
            type="time"
            value={time}
            aria-invalid={touched && invalid ? true : undefined}
            onChange={(event) => setTime(event.target.value)}
            data-testid="schedule-time"
          />
        </div>
      </div>
      <label className="sr-only" htmlFor="schedule-at">
        {m.editor_schedule_date_time()}
      </label>
      <input
        id="schedule-at"
        type="datetime-local"
        data-testid="schedule-at"
        className="sr-only"
        tabIndex={-1}
        value={date && time ? `${date}T${time}` : ''}
        onChange={(event) => {
          const [nextDate = '', nextTime = ''] = event.target.value.split('T')
          setDate(nextDate)
          setTime(nextTime.slice(0, 5))
        }}
      />

      <div className="grid gap-2">
        {changingZone ? (
          <div className="grid gap-1.5">
            <Label htmlFor="schedule-tz">{m.editor_time_zone()}</Label>
            <Select value={timeZone} onValueChange={setTimeZone}>
              <SelectTrigger
                className="w-full"
                id="schedule-tz"
                data-testid="schedule-tz"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone.replaceAll('_', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-callout text-text-secondary">
            <Globe className="size-4 text-icon-muted" />
            <span className="truncate">{timeZone.replaceAll('_', ' ')}</span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              className="font-medium text-text-accent hover:underline"
              onClick={() => setChangingZone(true)}
              data-testid="schedule-change-tz"
            >
              {m.editor_schedule_change_zone()}
            </button>
          </p>
        )}
      </div>

      <div
        className={cn(
          'flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-callout',
          touched && invalid
            ? 'bg-status-error-bg text-text-error'
            : 'bg-status-warning-bg text-text-primary',
        )}
        role={touched && invalid ? 'alert' : undefined}
      >
        <ClockIcon size={15} className="mt-px text-icon-warning" />
        <span>
          {touched && invalid
            ? m.editor_schedule_in_future()
            : summary
              ? m.editor_schedule_summary({ when: summary })
              : m.editor_schedule_pick()}
        </span>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="quiet" onClick={onCancel}>
          {m.editor_cancel()}
        </Button>
        <Button type="submit" loading={pending} data-testid="schedule-confirm">
          {pending ? m.editor_scheduling() : m.editor_schedule()}
        </Button>
      </div>
    </form>
  )
}
