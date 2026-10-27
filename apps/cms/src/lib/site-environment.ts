/**
 * Development environments (docs/design/dev-environments.md, Decision 3). A
 * pure predicate, so route modules and tests can use it without loading the
 * session or database code that `security/site-visibility` pulls in.
 */
export function isDevSite(site: { environment: string }): boolean {
  return site.environment === 'development'
}
