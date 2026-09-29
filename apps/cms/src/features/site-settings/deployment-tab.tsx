import * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  CheckCircle,
  CloudArrowUp,
  MagnifyingGlass,
  Prohibit,
} from '@phosphor-icons/react'
import { toast } from 'sonner'

import { errorMessage } from '#/components/admin/helpers'
import { Tag } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { FormField } from '#/components/ui/form-field'
import { InsetIcon } from '#/components/ui/inset-list'
import { Input } from '#/components/ui/input'
import { SettingsSection } from '#/components/ui/settings-section'
import { Skeleton } from '#/components/ui/skeleton'
import { displayHost } from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { SettingsSaveBar } from './settings-save-bar'
import { useDokployApplications } from './use-site-settings'
import type { DokployApplication, SiteRecord, useSiteSettings } from './use-site-settings'

function isUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function statusTone(status: string | null) {
  const value = (status ?? '').toLowerCase()
  if (value === 'done' || value === 'running') return 'success' as const
  if (value === 'error') return 'error' as const
  return 'neutral' as const
}

/**
 * Settings › Deployment (brief §3.10): the provider card, an application
 * picker fed by the client's verified Dokploy connection (with a manual
 * Application ID input as fallback), health check URL, and Stop deploying.
 */
export function DeploymentTab({
  site,
  meSite,
  settings,
}: {
  site: SiteRecord
  meSite: MeSite
  settings: ReturnType<typeof useSiteSettings>
}) {
  const formId = React.useId()
  const dokploy = useDokployApplications(site.organizationId)
  const savedApp = site.deploymentTarget?.applicationId ?? ''
  const savedHealth = site.deploymentTarget?.healthCheckUrl ?? ''
  const [appId, setAppId] = React.useState(savedApp)
  const [health, setHealth] = React.useState(savedHealth)
  const [errors, setErrors] = React.useState<{ app?: string; health?: string }>({})
  const [stopOpen, setStopOpen] = React.useState(false)

  React.useEffect(() => setAppId(savedApp), [savedApp])
  React.useEffect(() => setHealth(savedHealth), [savedHealth])

  const dirty = appId.trim() !== savedApp || health.trim() !== savedHealth
  const configured = dokploy.status.data?.configured === true
  const client = meSite.organizationName
  const applications = dokploy.applications.data?.applications ?? []
  const selectedApp = applications.find((app) => app.applicationId === appId.trim())
  const savedAppInfo = applications.find((app) => app.applicationId === savedApp)

  function discard() {
    setAppId(savedApp)
    setHealth(savedHealth)
    setErrors({})
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    const next = { app: appId.trim(), health: health.trim() }
    const problems: typeof errors = {}
    if (!next.app) problems.app = m.settings_health_needs_app()
    if (next.health && !isUrl(next.health)) problems.health = m.settings_url_invalid()
    setErrors(problems)
    if (problems.app || problems.health) return
    try {
      await settings.update.mutateAsync({
        deploymentTarget: {
          provider: 'dokploy',
          applicationId: next.app,
          healthCheckUrl: next.health || undefined,
        },
      })
      toast.success(m.sites_deployment_target_updated())
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div data-testid="settings-deployment">
      <SettingsSection
        title={m.settings_provider_title()}
        description={m.settings_provider_description()}
      >
        <div className="flex flex-wrap items-center gap-3" data-testid="deployment-provider">
          <InsetIcon tone={configured ? 'accent' : 'neutral'} className="size-10 rounded-[11px]">
            <CloudArrowUp weight="duotone" />
          </InsetIcon>
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="flex items-center gap-2 text-[14px] leading-5 font-medium text-text-primary">
              {m.settings_provider_dokploy()}
              {dokploy.status.isPending ? null : configured ? (
                <Tag tone="success">{m.settings_provider_connected_tag()}</Tag>
              ) : null}
            </span>
            <span className="truncate text-callout text-text-secondary">
              {dokploy.status.isPending ? (
                <Skeleton className="h-4 w-48" />
              ) : configured ? (
                m.settings_provider_connected({
                  client,
                  host: displayHost(dokploy.status.data?.url ?? ''),
                })
              ) : (
                m.settings_provider_not_connected({ client })
              )}
            </span>
          </div>
          <Button type="button" variant="secondary" size="sm" asChild>
            <Link
              to="/agency/clients/$orgId"
              params={{ orgId: site.organizationId }}
              search={{ tab: 'deployment' }}
              data-testid="deployment-setup-link"
            >
              {configured
                ? m.settings_provider_manage()
                : m.settings_provider_setup({ client })}
              <ArrowUpRight />
            </Link>
          </Button>
        </div>
        <p
          className="flex items-center gap-2 rounded-control bg-background-subtle px-3 py-2 text-callout text-text-secondary"
          data-testid="deployment-state"
        >
          {savedApp ? (
            <>
              <CheckCircle weight="fill" className="size-4 shrink-0 text-icon-success" />
              <span className="min-w-0 truncate">
                {m.settings_deploy_on({ app: savedAppInfo?.name ?? savedApp })}
              </span>
            </>
          ) : (
            <>
              <Prohibit className="size-4 shrink-0 text-icon-muted" />
              {m.settings_deploy_off()}
            </>
          )}
        </p>
      </SettingsSection>

      <form id={formId} noValidate onSubmit={onSubmit}>
        <SettingsSection
          title={m.settings_app_title()}
          description={m.settings_app_description()}
        >
          {configured ? (
            <ApplicationPicker
              query={dokploy.applications}
              value={appId.trim()}
              onChange={(next) => {
                setAppId(next)
                setErrors((prev) => ({ ...prev, app: undefined }))
              }}
            />
          ) : null}

          <FormField
            label={configured ? m.settings_app_manual() : m.sites_application_id()}
            htmlFor="application-id"
            hint={errors.app ? undefined : m.settings_app_manual_hint()}
            error={errors.app}
            trailing={
              appId.trim() && configured && dokploy.applications.isSuccess && !selectedApp ? (
                <Tag tone="warning">{m.settings_app_unknown()}</Tag>
              ) : undefined
            }
          >
            <Input
              id="application-id"
              data-testid="application-id"
              className="font-mono text-[13px]"
              autoComplete="off"
              spellCheck={false}
              value={appId}
              aria-invalid={errors.app ? true : undefined}
              onChange={(event) => {
                setAppId(event.target.value)
                setErrors((prev) => ({ ...prev, app: undefined }))
              }}
            />
          </FormField>

          <FormField
            label={m.sites_health_check_url()}
            htmlFor="health-check-url"
            hint={errors.health ? undefined : m.settings_health_hint()}
            error={errors.health}
          >
            <Input
              id="health-check-url"
              data-testid="health-check-url"
              type="url"
              inputMode="url"
              placeholder={m.sites_health_check_placeholder()}
              value={health}
              aria-invalid={errors.health ? true : undefined}
              onChange={(event) => {
                setHealth(event.target.value)
                setErrors((prev) => ({ ...prev, health: undefined }))
              }}
            />
          </FormField>
        </SettingsSection>
      </form>

      {site.deploymentTarget ? (
        <SettingsSection
          title={m.settings_stop_title()}
          description={m.settings_stop_description()}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-callout text-text-secondary">
              {m.settings_deploy_on({ app: savedAppInfo?.name ?? savedApp })}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={settings.update.isPending}
              onClick={() => setStopOpen(true)}
              data-testid="stop-deploying"
            >
              {m.settings_stop_button()}
            </Button>
          </div>
        </SettingsSection>
      ) : null}

      <ConfirmDialog
        open={stopOpen}
        onOpenChange={setStopOpen}
        title={m.settings_stop_confirm_title()}
        description={m.settings_stop_confirm_description()}
        confirmLabel={m.settings_stop_confirm()}
        variant="destructive"
        testId="stop-deploying-dialog"
        onConfirm={async () => {
          try {
            await settings.update.mutateAsync({ deploymentTarget: null })
            toast.success(m.sites_deployment_target_updated())
          } catch (error) {
            toast.error(errorMessage(error))
          }
        }}
      />

      <SettingsSaveBar
        dirty={dirty}
        saving={settings.update.isPending && !stopOpen}
        onDiscard={discard}
        formId={formId}
        saveTestId="save-deployment-target"
      />
    </div>
  )
}

/** Searchable single-choice list of the client's Dokploy applications. */
function ApplicationPicker({
  query,
  value,
  onChange,
}: {
  query: ReturnType<typeof useDokployApplications>['applications']
  value: string
  onChange: (applicationId: string) => void
}) {
  const [search, setSearch] = React.useState('')
  const applications = query.data?.applications ?? []
  const needle = search.trim().toLowerCase()
  const visible = needle
    ? applications.filter((app) =>
        `${app.name} ${app.appName ?? ''} ${app.applicationId}`.toLowerCase().includes(needle),
      )
    : applications

  if (query.isPending) {
    return (
      <div className="grid gap-2" aria-busy="true" aria-label={m.settings_app_loading()}>
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-12 rounded-control" />
        ))}
      </div>
    )
  }
  if (query.isError) {
    return (
      <p role="alert" className="rounded-control bg-status-error-bg px-3 py-2.5 text-callout text-text-error">
        {m.settings_app_load_error({ error: errorMessage(query.error) })}
      </p>
    )
  }

  return (
    <div className="grid gap-2" data-testid="application-picker">
      {applications.length > 5 ? (
        <div className="relative">
          <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-icon-muted" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={m.settings_app_search()}
            aria-label={m.settings_app_search()}
            className="pl-9"
            data-testid="application-search"
          />
        </div>
      ) : null}
      <div
        role="radiogroup"
        aria-label={m.settings_app_title()}
        className="scroll-quiet grid max-h-[288px] overflow-y-auto rounded-control border border-border-default"
      >
        {visible.length === 0 ? (
          <p className="px-3 py-4 text-center text-callout text-text-muted">{m.settings_app_none()}</p>
        ) : (
          visible.map((app) => (
            <ApplicationOption
              key={app.applicationId}
              app={app}
              selected={app.applicationId === value}
              onSelect={() => onChange(app.applicationId)}
            />
          ))
        )}
      </div>
      <p className="px-0.5 text-caption font-normal text-text-muted">
        {m.settings_app_count({ count: applications.length })}
      </p>
    </div>
  )
}

function ApplicationOption({
  app,
  selected,
  onSelect,
}: {
  app: DokployApplication
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      data-testid={`application-option-${app.applicationId}`}
      className={cn(
        'flex w-full items-center gap-3 border-b border-border-default px-3 py-2.5 text-left last:border-b-0',
        'transition-colors outline-none hover:bg-surface-state-hover focus-visible:bg-surface-state-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
        selected && 'bg-accent-soft/60 hover:bg-accent-soft/60',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-[18px] shrink-0 place-content-center rounded-full border',
          selected ? 'border-accent bg-accent' : 'border-border-strong bg-background-surface',
        )}
      >
        {selected ? <span className="size-1.5 rounded-full bg-accent-contrast" /> : null}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-[14px] leading-5 font-medium text-text-primary">{app.name}</span>
        <span className="truncate text-mono text-text-muted">{app.appName ?? app.applicationId}</span>
      </span>
      {app.applicationStatus ? (
        <Tag tone={statusTone(app.applicationStatus)}>{app.applicationStatus}</Tag>
      ) : null}
    </button>
  )
}
