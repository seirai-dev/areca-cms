/**
 * The one slug rule: lowercase letters and digits, joined by single hyphens
 * ("my-site-2"). Site keys, entry slugs and the forms that take them all use
 * it. Pure, so the browser and the server share the same check.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value)
}
