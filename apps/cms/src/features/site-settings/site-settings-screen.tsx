import { PageHeader } from '#/components/ui/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import type { MeSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'

import { LegacyContentTypes } from './legacy-content-types'
import { LegacySiteSettings } from './legacy-site-settings'

export const SETTINGS_TABS = [
  'general',
  'deployment',
  'developer',
  'content',
] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

/** Section of the legacy settings page each tab scrolls to (phase 1). */
const LEGACY_SECTION: Record<Exclude<SettingsTab, 'content'>, string | undefined> = {
  general: undefined,
  deployment: 'deployment',
  developer: 'token',
}

/**
 * Site settings (brief §3.10): underline tabs General · Deployment ·
 * Developer · Content. Phase 1 renders the old settings page under the first
 * three (scrolled to the section) and the content-type list under Content.
 */
export function SiteSettingsScreen({
  site,
  tab,
  onTabChange,
}: {
  site: MeSite
  tab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}) {
  const labels: Record<SettingsTab, string> = {
    general: m.settings_tab_general(),
    deployment: m.settings_tab_deployment(),
    developer: m.settings_tab_developer(),
    content: m.settings_tab_content(),
  }
  return (
    <div className="grid gap-6" data-testid="site-settings">
      <PageHeader
        title={m.shell_nav_settings()}
        description={m.settings_description({ site: site.name })}
      />
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as SettingsTab)}
        className="gap-6"
      >
        <TabsList>
          {SETTINGS_TABS.map((item) => (
            <TabsTrigger key={item} value={item} data-testid={`settings-tab-${item}`}>
              {labels[item]}
            </TabsTrigger>
          ))}
        </TabsList>
        {(['general', 'deployment', 'developer'] as const).map((item) => (
          <TabsContent key={item} value={item}>
            {tab === item ? (
              <LegacySiteSettings siteId={site.id} focusSection={LEGACY_SECTION[item]} />
            ) : null}
          </TabsContent>
        ))}
        <TabsContent value="content">
          {tab === 'content' ? <LegacyContentTypes siteId={site.id} /> : null}
        </TabsContent>
      </Tabs>
    </div>
  )
}
