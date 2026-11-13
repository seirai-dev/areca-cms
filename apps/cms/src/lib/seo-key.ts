/**
 * Per-entry SEO/GEO block. It is stored inside entry data under this reserved
 * key so drafts, revisions, scheduling and publishing carry it for free. The
 * `$` prefix fails `isSafeIdentifier`, so no content-model field can collide.
 * Snapshots move it out of `data` into a resolved top-level `entry.seo`.
 *
 * Kept apart from seo.ts so modules every page loads do not pull in its Zod
 * schemas.
 */
export const SEO_KEY = '$seo'
