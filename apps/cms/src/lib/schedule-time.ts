/**
 * Scheduling helpers: IANA zones, wall-clock conversion, DST gap/fold, and
 * past-instant skew. Pure, so the editor and the server share one policy.
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** Instants up to this far in the past may still be scheduled (“now”). */
export const SCHEDULE_PAST_SKEW_MS = 60_000

let cachedIanaZones: Set<string> | undefined

function ianaTimeZones(): Set<string> | undefined {
  if (cachedIanaZones) return cachedIanaZones
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      cachedIanaZones = new Set(Intl.supportedValuesOf('timeZone'))
      return cachedIanaZones
    }
  } catch {
    /* fall through to DateTimeFormat probe in isIanaTimeZone */
  }
  return undefined
}

/**
 * True for a real IANA zone (`Europe/Amsterdam`) or UTC (and UTC aliases).
 * Offset-only names like `+02:00` are rejected even when Intl would accept them.
 */
export function isIanaTimeZone(timeZone: string): boolean {
  if (!timeZone) return false
  try {
    const canonical = Intl.DateTimeFormat('en-US', {
      timeZone,
    }).resolvedOptions().timeZone
    if (!canonical) return false
    if (canonical === 'UTC') return true
    const known = ianaTimeZones()
    if (known) return known.has(timeZone) || known.has(canonical)
    return !/^[+-]\d{2}(?::?\d{2})?$/.test(canonical)
  } catch {
    return false
  }
}

const EXPLICIT_OFFSET = /(?:[Zz]|[+-]\d{2}(?::?\d{2})?)$/

/**
 * Parse an ISO-8601 instant that carries an explicit offset (`Z` or `±HH:MM`).
 * Zone-less strings are rejected even when `Date` would treat them as local.
 */
export function parseOffsetInstant(value: string): Date | null {
  const trimmed = value.trim()
  if (!trimmed || !EXPLICIT_OFFSET.test(trimmed)) return null
  const when = new Date(trimmed)
  return Number.isNaN(when.getTime()) ? null : when
}

export function isPastInstant(
  instant: Date,
  now = new Date(),
  skewMs = SCHEDULE_PAST_SKEW_MS,
) {
  return instant.getTime() < now.getTime() - skewMs
}

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
 * Returns null for incomplete input, invalid IANA zones, or DST gaps
 * (spring-forward missing wall times). At a DST fold (fall-back duplicated
 * wall time) the later UTC instant is chosen.
 */
export function zonedToInstant(date: string, time: string, timeZone: string) {
  if (!isIanaTimeZone(timeZone)) return null
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const tm = /^(\d{2}):(\d{2})/.exec(time)
  if (!dm || !tm) return null
  const wantedTime = `${tm[1]}:${tm[2]}`
  const guess = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2])
  if (Number.isNaN(guess)) return null

  const offsets = new Set<number>()
  for (const probe of [
    guess - 16 * 3_600_000,
    guess - 3_600_000,
    guess,
    guess + 3_600_000,
    guess + 16 * 3_600_000,
  ]) {
    offsets.add(zoneOffset(new Date(probe), timeZone))
  }

  const matches: Date[] = []
  for (const offset of offsets) {
    const instant = new Date(guess - offset)
    if (Number.isNaN(instant.getTime())) continue
    const wall = wallTime(instant, timeZone)
    if (wall.date === date && wall.time === wantedTime) matches.push(instant)
  }
  if (matches.length === 0) return null
  matches.sort((a, b) => b.getTime() - a.getTime())
  return matches[0] ?? null
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
