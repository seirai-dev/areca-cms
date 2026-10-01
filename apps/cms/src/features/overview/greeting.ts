import { m } from '#/paraglide/messages'

/** Words that name a role or a team rather than a person. */
const NOT_A_FIRST_NAME = new Set([
  'admin',
  'administrator',
  'agency',
  'editor',
  'hello',
  'info',
  'office',
  'owner',
  'support',
  'team',
])

function firstWord(value: string | null | undefined) {
  return (value ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

/**
 * The name to greet someone by: the first word of their account name, or
 * nothing when that word is clearly not a first name ("Acme Owner" on the
 * Acme site, "Agency Admin", an email address).
 */
export function greetingName(
  name: string | null | undefined,
  context: Array<string | null | undefined> = [],
) {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? ''
  const lower = first.toLowerCase()
  if (!first || first.includes('@') || NOT_A_FIRST_NAME.has(lower)) return null
  if (context.some((value) => firstWord(value) === lower)) return null
  return first
}

/** "Good morning, Kaan" (or just "Good morning") by the local hour. */
export function greeting(name: string | null, hour = new Date().getHours()) {
  const evening = hour < 5 || hour >= 18
  const morning = !evening && hour < 12
  if (!name) {
    if (evening) return m.overview_greeting_evening_plain()
    return morning
      ? m.overview_greeting_morning_plain()
      : m.overview_greeting_afternoon_plain()
  }
  if (evening) return m.overview_greeting_evening({ name })
  return morning
    ? m.overview_greeting_morning({ name })
    : m.overview_greeting_afternoon({ name })
}
