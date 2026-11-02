/**
 * Which values the Cloudflare card's form shows after an event. The form is
 * seeded from the saved connection only (first load, organization change,
 * Save and verify, Remove). Refreshes and verifies keep whatever the admin
 * typed, so a background refetch never wipes a pasted token.
 */

export type CloudflareFormEvent =
  'load' | 'org-change' | 'saved' | 'removed' | 'refresh' | 'verified'

export type CloudflareFormFields = {
  accountId: string
  apiToken: string
}

export function nextCloudflareFormFields({
  previousOrganizationId,
  organizationId,
  event,
  current,
  saved,
}: {
  /** The organization the form was last seeded for, or null before the first seed. */
  previousOrganizationId: string | null
  organizationId: string
  event: CloudflareFormEvent
  current: CloudflareFormFields
  /** The saved status; null when there is no status yet. */
  saved: { accountId: string | null } | null | undefined
}): CloudflareFormFields {
  const seeded: CloudflareFormFields = {
    accountId: saved?.accountId ?? '',
    apiToken: '',
  }

  switch (event) {
    case 'refresh':
    case 'verified':
      // Same organization: keep the admin's edits. A different organization
      // is never the same form, so it reseeds.
      return previousOrganizationId === organizationId ? current : seeded
    case 'removed':
      return { accountId: '', apiToken: '' }
    case 'load':
    case 'org-change':
    case 'saved':
      return seeded
  }
}
