import * as React from 'react'
import { CheckCircle, Prohibit } from '@phosphor-icons/react'
import { toast } from 'sonner'

import type { CloudflareDeployTarget } from '#/adapters/deployment/cloudflare-targets'
import { errorMessage } from '#/lib/errors'
import { useReleaseStatus } from '#/features/golive/use-release-status'
import { Tag } from '#/components/ui/tag'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { SettingsSection } from '#/components/ui/settings-section'
import { displayHost } from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'

import { CloudflareTargetFields } from './cloudflare-target-fields'
import {
  buildDeploymentTarget,
  draftTargetComplete,
  findListed,
  nextHealthUrl,
  pickTrigger,
  selectionFromListed,
  selectionFromTarget,
  targetIdentity,
} from './deployment-target-draft'
import type {
  CloudflareSelection,
  ProviderChoice,
} from './deployment-target-draft'
import { DokployTargetFields } from './dokploy-target-fields'
import { ProviderSwitch } from './provider-switch'
import { SettingsSaveBar } from './settings-save-bar'
import {
  useCloudflareConnection,
  useCloudflareDeployTargets,
  useDokployApplications,
} from './use-site-settings'
import type { SiteRecord, useSiteSettings } from './use-site-settings'

function isUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Settings › Deployment (brief §3.10). A Dokploy | Cloudflare switch, one
 * shared searchable target picker for the chosen provider, the health check
 * URL, and Stop deploying. Edits stay local until Save.
 */
export function DeploymentTab(props: DeploymentTabProps) {
  const { site } = props
  // The draft starts from the saved settings, and starts again whenever they
  // change (after a save, or a refetch that brings new values).
  const savedKey = JSON.stringify([site.publishingMode, site.deploymentTarget])
  return <DeploymentForm key={savedKey} {...props} />
}

type DeploymentTabProps = {
  site: SiteRecord
  meSite: MeSite
  settings: ReturnType<typeof useSiteSettings>
}

function DeploymentForm({ site, meSite, settings }: DeploymentTabProps) {
  const formId = React.useId()
  const client = meSite.organizationName
  const dokploy = useDokployApplications(site.organizationId)
  const cloudflareStatus = useCloudflareConnection(site.organizationId)
  const cloudflareConfigured = cloudflareStatus.data?.configured === true
  const targets = useCloudflareDeployTargets(
    site.organizationId,
    cloudflareConfigured,
  )
  const dokployConfigured = dokploy.status.data?.configured === true
  // While a release is queued, running or uncertain, the deployment settings wait.
  const release = useReleaseStatus(site.id)
  const locked = release.data?.deploymentPending === true
  const applications = dokploy.applications.data?.applications ?? []

  // The saved target, as the draft starts from it.
  const saved = site.deploymentTarget
  const savedProvider: ProviderChoice =
    saved?.provider === 'cloudflare' ? 'cloudflare' : 'dokploy'
  const savedApp = saved?.provider === 'dokploy' ? saved.applicationId : ''
  const savedHealth = saved?.healthCheckUrl ?? ''
  const savedSelection = React.useMemo(
    () => selectionFromTarget(saved),
    [saved],
  )
  const savedIdentity = targetIdentity(savedProvider, savedApp, savedSelection)

  const [mode, setMode] = React.useState<'production' | 'demo'>(
    site.publishingMode,
  )
  const [provider, setProvider] = React.useState<ProviderChoice>(savedProvider)
  const [appId, setAppId] = React.useState(savedApp)
  const [selection, setSelection] = React.useState<CloudflareSelection | null>(
    savedSelection,
  )
  const [health, setHealth] = React.useState(savedHealth)
  const [errors, setErrors] = React.useState<{
    target?: string
    health?: string
  }>({})
  const [stopOpen, setStopOpen] = React.useState(false)
  // This tab's own save. The settings mutation is shared with the other tabs.
  const [saving, setSaving] = React.useState(false)

  const draft = {
    provider,
    applicationId: appId.trim(),
    selection,
    healthCheckUrl: health.trim(),
  }

  // A site that has gone live stays in Production (the server refuses Demo too).
  const demoLocked = site.hasGoneLive && site.publishingMode === 'production'
  const modeHint = demoLocked
    ? m.settings_publishing_mode_demo_locked()
    : mode === 'production' && !draftTargetComplete(draft)
      ? m.settings_publishing_mode_needs_target()
      : null
  const modeHintId = React.useId()

  const listed =
    selection && targets.data ? findListed(selection, targets.data) : null
  const dirty =
    mode !== site.publishingMode ||
    targetIdentity(provider, appId.trim(), selection) !== savedIdentity ||
    health.trim() !== savedHealth

  function discard() {
    setMode(site.publishingMode)
    setProvider(savedProvider)
    setAppId(savedApp)
    setSelection(savedSelection)
    setHealth(savedHealth)
    setErrors({})
  }

  /** Switching provider clears the chosen target and the health URL. */
  function changeProvider(next: ProviderChoice) {
    if (next === provider) return
    setProvider(next)
    setSelection(null)
    setAppId('')
    setHealth('')
    setErrors({})
  }

  /** The health URL follows the project's suggestion unless the admin typed one. */
  function pickCloudflare(target: CloudflareDeployTarget) {
    const fill = nextHealthUrl({
      current: health,
      previousSuggestion: listed?.suggestedHealthUrl ?? null,
      suggestion: target.suggestedHealthUrl,
    })
    setSelection(selectionFromListed(target))
    if (fill !== null) setHealth(fill)
    setErrors((prev) => ({ ...prev, target: undefined }))
  }

  function pickCloudflareTrigger(triggerUuid: string) {
    setSelection((prev) =>
      prev ? pickTrigger(prev, listed, triggerUuid) : prev,
    )
  }

  function targetProblem() {
    if (provider === 'dokploy') return m.settings_health_needs_app()
    if (selection?.kind === 'workers' && !selection.triggerUuid) {
      return m.settings_cloudflare_needs_trigger()
    }
    return m.settings_cloudflare_needs_target()
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedHealth = draft.healthCheckUrl
    const target = buildDeploymentTarget(draft)
    const problems: typeof errors = {}
    if (mode === 'production' && !target) problems.target = targetProblem()
    if (
      (mode === 'production' && !trimmedHealth) ||
      (trimmedHealth && !isUrl(trimmedHealth))
    )
      problems.health = m.settings_url_invalid()
    setErrors(problems)
    if (problems.target || problems.health) return
    await persist({ publishingMode: mode, deploymentTarget: target })
  }

  async function persist(
    patch: Parameters<typeof settings.update.mutateAsync>[0],
  ) {
    setSaving(true)
    try {
      await settings.update.mutateAsync(patch)
      toast.success(m.sites_deployment_target_updated())
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const savedAppInfo = applications.find(
    (app) => app.applicationId === savedApp,
  )
  const savedSummary = !saved
    ? null
    : saved.provider === 'dokploy'
      ? m.settings_deploy_on({ app: savedAppInfo?.name ?? saved.applicationId })
      : saved.kind === 'pages'
        ? m.settings_deploy_on_cloudflare_pages({ name: saved.projectName })
        : m.settings_deploy_on_cloudflare_workers({ name: saved.scriptName })

  return (
    <div data-testid="settings-deployment">
      {locked ? (
        <p
          role="status"
          data-testid="deployment-locked-notice"
          className="rounded-control bg-status-warning-bg px-3 py-2.5 text-callout text-text-warning"
        >
          {m.settings_deployment_locked()}
        </p>
      ) : null}

      <SettingsSection
        title={m.settings_publishing_mode_title()}
        description={m.settings_publishing_mode_description()}
      >
        <label htmlFor="publishing-mode">
          {m.settings_publishing_mode_label()}
        </label>
        <select
          id="publishing-mode"
          data-testid="publishing-mode"
          value={mode}
          disabled={locked}
          aria-describedby={modeHint ? modeHintId : undefined}
          onChange={(event) =>
            setMode(event.target.value as 'production' | 'demo')
          }
          className="w-full min-w-0 rounded-control border border-border-default p-2"
        >
          <option value="production">
            {m.settings_publishing_mode_production()}
          </option>
          <option value="demo" disabled={demoLocked}>
            {m.settings_publishing_mode_demo()}
          </option>
        </select>
        {modeHint ? (
          <p
            id={modeHintId}
            data-testid="publishing-mode-hint"
            className="text-callout text-text-secondary"
          >
            {modeHint}
          </p>
        ) : null}
        {site.publishingMode === 'demo' ? (
          <Tag tone="warning">{m.settings_publishing_mode_demo_warning()}</Tag>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title={m.settings_provider_title()}
        description={m.settings_provider_description()}
      >
        <ProviderSwitch
          value={provider}
          onChange={changeProvider}
          locked={locked}
          organizationId={site.organizationId}
          clientName={client}
          dokploy={{
            configured: dokployConfigured,
            pending: dokploy.status.isPending,
            host: displayHost(dokploy.status.data?.url ?? ''),
          }}
          cloudflare={{
            configured: cloudflareConfigured,
            pending: cloudflareStatus.isPending,
          }}
        />
        <p
          className="flex items-center gap-2 rounded-control bg-background-subtle px-3 py-2 text-callout text-text-secondary"
          data-testid="deployment-state"
        >
          {savedSummary ? (
            <>
              <CheckCircle
                weight="fill"
                className="size-4 shrink-0 text-icon-success"
              />
              <span className="min-w-0 truncate">{savedSummary}</span>
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
          title={
            provider === 'cloudflare'
              ? m.settings_cloudflare_project_title()
              : m.settings_app_title()
          }
          description={
            provider === 'cloudflare'
              ? m.settings_cloudflare_project_description()
              : m.settings_app_description()
          }
        >
          {provider === 'cloudflare' ? (
            <CloudflareTargetFields
              enabled={cloudflareConfigured}
              clientName={client}
              targets={targets}
              selection={selection}
              error={errors.target}
              disabled={locked}
              onPick={pickCloudflare}
              onPickTrigger={pickCloudflareTrigger}
            />
          ) : (
            <DokployTargetFields
              configured={dokployConfigured}
              applications={dokploy.applications}
              appId={appId.trim()}
              error={errors.target}
              disabled={locked}
              onPick={(next) => {
                setAppId(next)
                setErrors((prev) => ({ ...prev, target: undefined }))
              }}
              onManualChange={(next) => {
                setAppId(next)
                setErrors((prev) => ({ ...prev, target: undefined }))
              }}
            />
          )}

          <FormField
            label={m.sites_health_check_url()}
            htmlFor="health-check-url"
            hint={
              errors.health
                ? undefined
                : mode === 'production'
                  ? m.settings_health_hint_required()
                  : m.settings_health_hint()
            }
            error={errors.health}
          >
            <Input
              id="health-check-url"
              data-testid="health-check-url"
              type="url"
              inputMode="url"
              placeholder={m.sites_health_check_placeholder()}
              value={health}
              disabled={locked}
              aria-invalid={errors.health ? true : undefined}
              onChange={(event) => {
                setHealth(event.target.value)
                setErrors((prev) => ({ ...prev, health: undefined }))
              }}
            />
          </FormField>
        </SettingsSection>
      </form>

      {saved ? (
        <SettingsSection
          title={m.settings_stop_title()}
          description={m.settings_stop_description()}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-callout text-text-secondary">
              {savedSummary}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={settings.update.isPending || locked}
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
        description={
          saved?.provider === 'cloudflare'
            ? m.settings_stop_confirm_description_cloudflare()
            : m.settings_stop_confirm_description()
        }
        confirmLabel={m.settings_stop_confirm()}
        variant="destructive"
        testId="stop-deploying-dialog"
        onConfirm={() => persist({ deploymentTarget: null })}
      />

      <SettingsSaveBar
        dirty={dirty}
        saving={saving && !stopOpen}
        onDiscard={discard}
        formId={formId}
        saveTestId="save-deployment-target"
        disabled={locked}
      />
    </div>
  )
}
