export type CloudflareFormFields = {
  accountId: string
  apiToken: string
}

/**
 * The Cloudflare card's form, seeded from the saved connection: its account
 * ID and never a token. Null (nothing saved, or just removed) empties both.
 */
export function seededCloudflareFields(
  saved: { accountId: string | null } | null | undefined,
): CloudflareFormFields {
  return { accountId: saved?.accountId ?? '', apiToken: '' }
}
