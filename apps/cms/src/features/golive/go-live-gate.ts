/**
 * Whether the Go live control may run. A blocked site (for example a required
 * site content section that was never marked ready) cannot go live, so the
 * panel, tray and overview all use this one rule.
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
