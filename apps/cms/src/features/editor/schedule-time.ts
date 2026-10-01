/**
 * Scheduling helpers (brief §3.5): the quick chips and turning a wall-clock
 * date and time in a chosen time zone into an instant. Pure, so they are
 * unit tested.
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD` and `HH:MM` of `date` as seen in `timeZone`. */
export function wallTime(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`,
  }
}

/** Offset of `timeZone` from UTC at `date`, in ms (Amsterdam summer: +2h). */
function zoneOffset(date: Date, timeZone: string) {
  const { date: day, time } = wallTime(date, timeZone)
  const [y, mo, d] = day.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const asUtc = Date.UTC(y, mo - 1, d, h, mi)
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000
}

/**
 * The instant at which the clock in `timeZone` reads `date` `time`.
 * Returns null for incomplete input.
 */
export function zonedToInstant(date: string, time: string, timeZone: string) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const tm = /^(\d{2}):(\d{2})/.exec(time)
  if (!dm || !tm) return null
  const guess = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2])
  let result = guess - zoneOffset(new Date(guess), timeZone)
  // Second pass settles DST transitions.
  result = guess - zoneOffset(new Date(result), timeZone)
  const instant = new Date(result)
  return Number.isNaN(instant.getTime()) ? null : instant
}

export type SchedulePreset = 'tomorrow' | 'monday' | 'hour'

/**
 * Quick chips: "Tomorrow 9:00", "Monday 9:00" (the next Monday, a week
 * ahead when today is Monday) and "In 1 hour" (rounded up to 5 minutes).
 * Day presets are wall times in `timeZone`.
 */
export function presetInstant(
  preset: SchedulePreset,
  timeZone: string,
  now = new Date(),
) {
  if (preset === 'hour') {
    const next = new Date(now.getTime() + 60 * 60_000)
    const minutes = next.getMinutes()
    const rounded = Math.ceil(minutes / 5) * 5
    next.setMinutes(rounded, 0, 0)
    return next
  }
  const today = wallTime(now, timeZone).date
  const [y, m, d] = today.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  let add = 1
  if (preset === 'monday') {
    const weekday = base.getUTCDay() // 0 Sunday … 6 Saturday
    add = (8 - weekday) % 7 || 7
  }
  base.setUTCDate(base.getUTCDate() + add)
  const day = `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`
  return zonedToInstant(day, '09:00', timeZone)!
}
