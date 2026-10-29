/**
 * The site origin that previews load from: the optional `previewUrl` setting,
 * falling back to `productionUrl`. Plain module on purpose: server/fn files
 * must not export helpers (their imports would leak into the client bundle).
 */
export function previewBaseUrl(site: {
  previewUrl?: string | null
  productionUrl: string
}): string {
  return site.previewUrl ? site.previewUrl : site.productionUrl
}

/** The origin of the preview base URL, or null when it is not a valid URL. */
export function previewOrigin(site: {
  previewUrl?: string | null
  productionUrl: string
}): string | null {
  try {
    return new URL(previewBaseUrl(site)).origin
  } catch {
    return null
  }
}

/**
 * Validates and normalises a preview URL typed in Settings › General. Empty
 * input means "not set" (null). Otherwise the value must be an http(s) origin:
 * no path beyond `/`, no query and no hash. Trailing slashes are stripped.
 * Throws an Error with a short English message when the value is invalid; the
 * server maps it to a validation error.
 */
export function normalizePreviewUrl(
  input: string | null | undefined,
): string | null {
  const trimmed = (input?.trim() ?? '').replace(/\/+$/, '')
  if (!trimmed) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Enter a full address, like https://staging.example.com.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The preview URL must use http or https.')
  }
  if (url.username || url.password) {
    throw new Error('The preview URL must not contain a user name or password.')
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      'The preview URL is an address only, without a path, query or hash.',
    )
  }
  return url.origin
}
