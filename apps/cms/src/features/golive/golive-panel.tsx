import * as React from 'react'
import { Link, useRouteContext } from '@tanstack/react-router'
import { Lightning, RocketLaunch } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { SlideOver } from '#/components/ui/slide-over'
import { Switch } from '#/components/ui/switch'
import { Hint } from '#/components/ui/tooltip'
import { usePanel } from '#/features/shell/panel'
import type { MeSite } from '#/lib/site-nav'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { ErrorChecklist } from './error-checklist'
import { withMonoCommand } from './golive-tray'
import { canGoLive, goLiveReason } from './go-live-gate'
import { Section } from './panel-section'
import { ReleaseHistory } from './release-history'
import { StatusHero } from './status-hero'
import { useGoLive } from './use-go-live'
import { usePendingEntries } from './use-pending-entries'
import { useReleaseStatus } from './use-release-status'
import { WhatsChanging } from './whats-changing'

/**
 * The Go‑live panel (brief §3.6): a right slide-over opened by
 * `?panel=golive`. Status hero, what's changing, controls (urgent + Go live),
 * validation checklist, and the release history as a timeline with build
 * details, logs, cancel and restore. Replaces the old Releases page.
 *
 * Editors see everything; actions are disabled with the reason (§1.3).
 */
export function GoLivePanel({
  site,
  canPublish,
}: {
  site: MeSite
  canPublish: boolean
}) {
  const panel = usePanel()
  const open = panel.panel === 'golive'
  const demo = useReleaseStatus(site.id).data?.publishingMode === 'demo'

  return (
    <SlideOver
      open={open}
      onOpenChange={(next) => {
        if (!next) panel.close()
      }}
      title={demo ? m.golive_demo_publish_release() : m.golive_go_live()}
      description={site.name}
      data-testid="golive-panel"
      bodyClassName="px-0 pb-0"
    >
      {open ? (
        <GoLivePanelBody
          site={site}
          canPublish={canPublish}
          focusRelease={panel.release}
        />
      ) : null}
    </SlideOver>
  )
}

function GoLivePanelBody({
  site,
  canPublish,
  focusRelease,
}: {
  site: MeSite
  canPublish: boolean
  focusRelease?: string
}) {
  const release = useReleaseStatus(site.id)
  const { goLive, isPending, errors, clearErrors } = useGoLive(site.id)
  const [urgent, setUrgent] = React.useState(false)
  const demo = release.data?.publishingMode === 'demo'
  const isAgencyAdmin = useRouteContext({ from: '/_app' }).me.user.isAgencyAdmin
  const pending = usePendingEntries({
    siteId: site.id,
    enabled: release.state !== 'loading',
  })
  // Going live without knowing what changes is not allowed: wait for the list.
  const changesKnown = pending.isSuccess
  const goLiveAllowed =
    canGoLive({
      canPublish,
      blockers: release.data?.blockers,
    }) && changesKnown
  const reason = goLiveReason({
    canPublish,
    blockers: release.data?.blockers,
    changesKnown,
  })
  // Blockers are listed in the red box above; the button area then only points there.
  const blocked = errors.length > 0 || (release.data?.blockers.length ?? 0) > 0
  const disabledText = blocked ? m.golive_fix_items_above() : reason

  return (
    <div className="grid divide-y divide-border-default">
      {demo ? (
        <Section>
          <div
            data-testid="demo-publication-label"
            role="status"
            className="grid gap-0.5"
          >
            <p className="text-[14px] leading-5 font-semibold text-text-primary">
              {release.data?.demo
                ? m.golive_demo_tray_ready()
                : m.golive_demo_tray_none()}
            </p>
            <p className="text-callout text-text-secondary">
              {withMonoCommand(
                m.golive_demo_tray_hint({ command: 'areca pull' }),
                'areca pull',
              )}
            </p>
          </div>
        </Section>
      ) : (
        <StatusHero site={site} release={release} />
      )}

      {errors.length > 0 ? (
        <Section>
          <ErrorChecklist
            siteId={site.id}
            errors={errors}
            onDismiss={clearErrors}
          />
        </Section>
      ) : release.data && release.data.blockers.length > 0 ? (
        <Section>
          <ErrorChecklist siteId={site.id} errors={release.data.blockers} />
        </Section>
      ) : null}

      <Section
        title={m.golive_whats_changing()}
        actions={
          pending.changeCount > 0 ? (
            <span className="text-caption font-normal text-text-muted tnum">
              {pending.changeCount}
            </span>
          ) : null
        }
      >
        <WhatsChanging siteId={site.id} pending={pending} demo={demo} />
      </Section>

      <Section>
        <div className="grid gap-4">
          {demo ? null : (
            <label
              className={cn(
                'flex items-center justify-between gap-4 rounded-[12px] bg-background-subtle px-3.5 py-3',
                !goLiveAllowed && 'opacity-60',
              )}
            >
              <span className="grid gap-0.5">
                <span className="flex items-center gap-1.5 text-[14px] leading-5 font-medium text-text-primary">
                  <Lightning
                    weight="fill"
                    className="size-4 text-icon-warning"
                  />
                  {m.golive_urgent()}
                </span>
                <span className="text-callout text-text-secondary">
                  {m.golive_urgent_hint()}
                </span>
              </span>
              <Switch
                checked={urgent}
                onCheckedChange={setUrgent}
                disabled={!goLiveAllowed}
                data-testid="golive-urgent"
                aria-label={m.golive_urgent()}
              />
            </label>
          )}
          <Hint
            label={goLiveAllowed ? null : disabledText}
            wrapDisabled={!goLiveAllowed}
            className="w-full"
          >
            <Button
              type="button"
              size="lg"
              className="w-full"
              data-testid="publish-site-confirm"
              disabled={!goLiveAllowed || release.state === 'going-live'}
              loading={isPending}
              onClick={() => void goLive({ urgent })}
            >
              {isPending ? null : <RocketLaunch weight="fill" />}
              {release.state === 'going-live'
                ? m.golive_going_live()
                : demo
                  ? m.golive_demo_publish_release()
                  : m.golive_go_live()}
            </Button>
          </Hint>
          {!goLiveAllowed ? (
            <p className="text-center text-callout text-text-secondary">
              {disabledText}
            </p>
          ) : null}
          {demo && isAgencyAdmin ? (
            <Link
              to="/sites/$siteId/settings"
              params={{ siteId: site.id }}
              search={{ tab: 'deployment' }}
              className="justify-self-center text-caption font-medium text-text-accent hover:underline"
            >
              {m.golive_switch_to_production()}
            </Link>
          ) : null}
        </div>
      </Section>

      <ReleaseHistory
        siteId={site.id}
        canManage={canPublish}
        demo={demo}
        focusRelease={focusRelease}
      />
    </div>
  )
}
