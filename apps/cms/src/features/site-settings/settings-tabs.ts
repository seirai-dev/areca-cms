import { isDevSite } from '#/lib/site-environment'

/** The settings tabs, in order. The route validates `?tab=` against it. */
export const SETTINGS_TABS = [
  'general',
  'languages',
  'deployment',
  'development',
  'developer',
  'ai',
  'content',
] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

/**
 * The tabs a site shows. A development environment stays in Demo mode and
 * has no deployment target, so it has neither Deployment nor Development. A
 * production site gets Development once it is in Production mode or has gone
 * live (docs/design/dev-environments.md, Decision 5).
 */
export function settingsTabsFor(site: {
  environment: string
  publishingMode: string
  hasGoneLive: boolean
}): SettingsTab[] {
  if (isDevSite(site)) {
    return SETTINGS_TABS.filter(
      (tab) => tab !== 'deployment' && tab !== 'development',
    )
  }
  const canDevelop = site.publishingMode === 'production' || site.hasGoneLive
  return SETTINGS_TABS.filter((tab) => tab !== 'development' || canDevelop)
}
