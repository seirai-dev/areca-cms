import { m } from '#/paraglide/messages'

/**
 * Whether the Go live control may run. A blocked site (for example a required
 * site content section that was never marked ready, or no deployment target)
 * cannot go live, so the panel, tray and overview all use this one rule.
 */
export function canGoLive({
  canPublish,
  blockers,
}: {
  canPublish: boolean
  blockers?: readonly string[] | null
}): boolean {
  return canPublish && (blockers?.length ?? 0) === 0
}

/**
 * Why Go live is off, for the hint beside it; undefined when it is on. The
 * panel, tray and overview all use this order: role, then the first blocker,
 * then the change list (which must have loaded).
 */
export function goLiveReason({
  canPublish,
  blockers,
  changesKnown,
}: {
  canPublish: boolean
  blockers?: readonly string[] | null
  changesKnown: boolean
}): string | undefined {
  if (!canPublish) return m.golive_editor_reason()
  if (blockers && blockers.length > 0) return blockers[0]
  if (!changesKnown) return m.golive_changes_unavailable()
  return undefined
}
