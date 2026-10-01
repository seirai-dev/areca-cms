import * as React from 'react'

import { SegmentedControl } from '#/components/ui/segmented-control'
import { SlideOver } from '#/components/ui/slide-over'
import { usePanel } from '#/features/shell/panel'
import type { MeSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'

import { ActivityList } from './activity-list'

type Scope = 'site' | 'client'

/**
 * The Activity panel (brief §3.7): a right slide-over opened by
 * `?panel=activity`, for owners and admins. A segmented filter switches
 * between "This site" (server `siteId` filter) and "All {client} sites".
 */
export function ActivityPanel({ site }: { site: MeSite }) {
  const panel = usePanel()
  const open = panel.panel === 'activity'
  const [scope, setScope] = React.useState<Scope>('site')

  return (
    <SlideOver
      open={open}
      onOpenChange={(next) => {
        if (!next) panel.close()
      }}
      title={m.activity_title()}
      description={site.name}
      data-testid="activity-panel"
    >
      <div className="grid gap-5 pt-1">
        <SegmentedControl<Scope>
          aria-label={m.activity_filter_label()}
          data-testid="activity-scope"
          fullWidth
          value={scope}
          onValueChange={setScope}
          options={[
            {
              value: 'site',
              label: m.activity_this_site(),
              testId: 'activity-scope-site',
            },
            {
              value: 'client',
              label: m.activity_all_client_sites({
                client: site.organizationName,
              }),
              testId: 'activity-scope-client',
            },
          ]}
        />
        {open ? (
          <ActivityList
            key={scope}
            organizationId={site.organizationId}
            siteId={scope === 'site' ? site.id : undefined}
            showScope={scope === 'client'}
          />
        ) : null}
      </div>
    </SlideOver>
  )
}
