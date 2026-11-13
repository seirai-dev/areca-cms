import type * as React from 'react'

import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import {
  Tabs,
  PersistentTabsContent as TabsContent,
  TabsList,
  TabsTrigger,
} from '#/components/ui/tabs'
import { isDevSite } from '#/lib/site-environment'
import type { MeSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'

import { ContentModelTab } from '#/features/content-model/content-model-tab'
import { AiTab } from './ai-tab'
import { DeploymentTab } from './deployment-tab'
import { DeveloperTab } from './developer-tab'
import { DevelopmentTab } from './development-tab'
import { GeneralTab } from './general-tab'
import { LanguagesTab } from './languages-tab'
import { SETTINGS_TABS, settingsTabsFor } from './settings-tabs'
import type { SettingsTab } from './settings-tabs'
import { useSiteSettings } from './use-site-settings'

/**
 * Site settings (brief §3.10), agency admins only: underline tabs
 * General · Languages · Deployment · Developer · AI · Content, addressable as `?tab=`.
 * Test ids: `site-settings`, `settings-tab-{tab}`, `site-header-slug`.
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
  const settings = useSiteSettings(site.id)
  const record = settings.site.data
  const labels: Record<SettingsTab, string> = {
    general: m.settings_tab_general(),
    languages: m.settings_tab_languages(),
    deployment: m.settings_tab_deployment(),
    development: m.settings_tab_development(),
    developer: m.settings_tab_developer(),
    ai: m.settings_tab_ai(),
    content: m.settings_tab_content(),
  }
  // Until the record loads, a development environment is recognised from the
  // list entry; the production tabs wait for the full record.
  const visible = record
    ? settingsTabsFor(record)
    : SETTINGS_TABS.filter(
        (item) =>
          item !== 'development' && (item !== 'deployment' || !isDevSite(site)),
      )
  const shown = (item: SettingsTab) => visible.includes(item)

  const body = (
    render: (record: NonNullable<typeof settings.site.data>) => React.ReactNode,
  ) =>
    settings.site.isError ? (
      <QueryError title={m.settings_load_error()} query={settings.site} />
    ) : record ? (
      render(record)
    ) : (
      <SettingsSkeleton />
    )

  return (
    <div className="grid gap-6 pb-24" data-testid="site-settings">
      <PageHeader
        title={m.shell_nav_settings()}
        description={m.settings_description({ site: site.name })}
        meta={
          <span className="font-mono" data-testid="site-header-slug">
            {site.slug}
          </span>
        }
      />
      <Tabs
        value={shown(tab) ? tab : 'general'}
        onValueChange={(value) => onTabChange(value as SettingsTab)}
        className="gap-8"
      >
        <TabsList>
          {SETTINGS_TABS.filter(shown).map((item) => (
            <TabsTrigger
              key={item}
              value={item}
              data-testid={`settings-tab-${item}`}
            >
              {labels[item]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general">
          {body((r) => (
            <GeneralTab site={r} settings={settings} />
          ))}
        </TabsContent>
        <TabsContent value="languages">
          {body((r) => (
            <LanguagesTab site={r} settings={settings} />
          ))}
        </TabsContent>
        {shown('deployment') ? (
          <TabsContent value="deployment">
            {body((r) => (
              <DeploymentTab site={r} meSite={site} settings={settings} />
            ))}
          </TabsContent>
        ) : null}
        {shown('development') ? (
          <TabsContent value="development">
            {body((r) => (
              <DevelopmentTab site={r} />
            ))}
          </TabsContent>
        ) : null}
        <TabsContent value="developer">
          {body((r) => (
            <DeveloperTab site={r} settings={settings} />
          ))}
        </TabsContent>
        <TabsContent value="ai">
          {body((r) => (
            <AiTab site={r} settings={settings} />
          ))}
        </TabsContent>
        <TabsContent value="content">
          <ContentModelTab siteId={site.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div
      className="grid gap-4 min-[900px]:grid-cols-[280px_minmax(0,1fr)] min-[900px]:gap-10"
      aria-hidden="true"
    >
      <div className="grid content-start gap-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-56" />
      </div>
      <Skeleton className="h-48 rounded-card" />
    </div>
  )
}
