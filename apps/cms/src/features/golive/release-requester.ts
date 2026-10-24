import type { PublicationOrigin } from './queries'

/**
 * Who started a release, as the Go-live list words it. A release with a
 * requester shows their name. With no requester, the scheduler started it
 * (`origin` "scheduled", so "Started automatically") or the person who
 * started it has since been deleted (their row was removed and the requester
 * link set to null), which reads "Deleted user".
 */
export function releaseRequesterKey(input: {
  requestedByName: string | null
  origin: PublicationOrigin
}):
  | { kind: 'person'; name: string }
  | { kind: 'automatic' }
  | { kind: 'deleted' } {
  if (input.requestedByName) {
    return { kind: 'person', name: input.requestedByName }
  }
  return input.origin === 'scheduled'
    ? { kind: 'automatic' }
    : { kind: 'deleted' }
}
