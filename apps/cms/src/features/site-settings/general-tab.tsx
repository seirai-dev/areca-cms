import * as React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { errorMessage } from '#/lib/admin/helpers'
import { normalizePreviewUrl } from '#/lib/preview-url'
import { isDevSite } from '#/lib/site-environment'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { SettingsSection } from '#/components/ui/settings-section'
import { m } from '#/paraglide/messages'

import { SettingsSaveBar } from './settings-save-bar'
import { useDevEnvironment } from './use-dev-environment'
import type { SiteRecord, useSiteSettings } from './use-site-settings'

function isUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Settings › General: name, production URL, preview URL, and the danger zone. */
export function GeneralTab({
  site,
  settings,
}: {
  site: SiteRecord
  settings: ReturnType<typeof useSiteSettings>
}) {
  const navigate = useNavigate()
  const formId = React.useId()
  // A development environment's URL is its local preview address (Decision 10).
  const dev = isDevSite(site)
  const [name, setName] = React.useState(site.name)
  const [url, setUrl] = React.useState(site.productionUrl)
  const [previewUrl, setPreviewUrl] = React.useState(site.previewUrl ?? '')
  const [errors, setErrors] = React.useState<{
    name?: string
    url?: string
    previewUrl?: string
  }>({})

  // Follow the server copy until the user starts editing.
  React.useEffect(() => setName(site.name), [site.name])
  React.useEffect(() => setUrl(site.productionUrl), [site.productionUrl])
  React.useEffect(() => setPreviewUrl(site.previewUrl ?? ''), [site.previewUrl])

  const dirty =
    name !== site.name ||
    url !== site.productionUrl ||
    previewUrl.trim() !== (site.previewUrl ?? '')

  function discard() {
    setName(site.name)
    setUrl(site.productionUrl)
    setPreviewUrl(site.previewUrl ?? '')
    setErrors({})
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    const next = { name: name.trim(), url: url.trim() }
    const problems: typeof errors = {}
    if (!next.name) problems.name = m.settings_name_required()
    if (!isUrl(next.url)) problems.url = m.settings_url_invalid()
    let nextPreview: string | null = null
    try {
      nextPreview = normalizePreviewUrl(previewUrl)
    } catch {
      problems.previewUrl = m.settings_preview_url_invalid()
    }
    setErrors(problems)
    if (problems.name || problems.url || problems.previewUrl) return
    try {
      await settings.update.mutateAsync({
        name: next.name,
        productionUrl: next.url,
        // Null clears the setting: previews fall back to the production URL.
        previewUrl: nextPreview,
      })
      setName(next.name)
      setUrl(next.url)
      setPreviewUrl(nextPreview ?? '')
      toast.success(m.sites_updated())
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div data-testid="settings-general">
      <form id={formId} noValidate onSubmit={onSubmit}>
        <SettingsSection
          title={m.settings_general_site_title()}
          description={m.settings_general_site_description()}
        >
          <FormField
            label={m.sites_name()}
            htmlFor="settings-site-name"
            error={errors.name}
          >
            <Input
              id="settings-site-name"
              data-testid="settings-site-name"
              value={name}
              required
              aria-invalid={errors.name ? true : undefined}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField
            label={dev ? m.dev_env_preview_url() : m.sites_production_url()}
            htmlFor="settings-production-url"
            hint={
              errors.url
                ? undefined
                : dev
                  ? m.dev_env_preview_url_hint()
                  : m.settings_production_url_hint()
            }
            error={errors.url}
          >
            <Input
              id="settings-production-url"
              data-testid="site-production-url"
              type="url"
              inputMode="url"
              required
              placeholder={m.sites_url_placeholder()}
              value={url}
              aria-invalid={errors.url ? true : undefined}
              onChange={(event) => setUrl(event.target.value)}
            />
          </FormField>
          {/* A dev environment's main URL already is its preview address. */}
          {dev ? null : (
            <FormField
              label={m.settings_preview_url()}
              htmlFor="settings-preview-url"
              hint={
                errors.previewUrl ? undefined : m.settings_preview_url_hint()
              }
              error={errors.previewUrl}
            >
              <Input
                id="settings-preview-url"
                data-testid="site-preview-url"
                type="url"
                inputMode="url"
                placeholder={site.productionUrl}
                value={previewUrl}
                aria-invalid={errors.previewUrl ? true : undefined}
                onChange={(event) => setPreviewUrl(event.target.value)}
              />
            </FormField>
          )}
        </SettingsSection>
      </form>

      {dev && site.parentSiteId ? (
        <DevEnvironmentDangerZone
          devSite={site}
          productionId={site.parentSiteId}
        />
      ) : (
        <SettingsSection
          title={m.sites_danger_zone()}
          description={m.settings_delete_description()}
          danger
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="grid gap-0.5">
              <p className="text-[14px] leading-5 font-medium text-text-primary">
                {m.settings_delete_title()}
              </p>
              <p className="text-callout text-text-secondary">{site.name}</p>
            </div>
            <ConfirmDialog
              title={m.sites_delete_site_title()}
              description={m.sites_delete_site_description({ name: site.name })}
              confirmLabel={m.sites_delete_site()}
              confirmText={site.slug}
              variant="destructive"
              testId="delete-site-dialog"
              onConfirm={async () => {
                try {
                  await settings.remove.mutateAsync()
                  toast.success(m.sites_deleted())
                  await navigate({ to: '/' })
                } catch (error) {
                  toast.error(errorMessage(error))
                }
              }}
            >
              <Button
                type="button"
                variant="outline"
                className="text-text-error hover:bg-status-error-bg hover:text-text-error"
                data-testid="delete-site"
              >
                <Trash />
                {m.settings_delete_button()}
              </Button>
            </ConfirmDialog>
          </div>
        </SettingsSection>
      )}

      <SettingsSaveBar
        dirty={dirty}
        saving={settings.update.isPending}
        onDiscard={discard}
        formId={formId}
        saveTestId="save-general"
      />
    </div>
  )
}

/**
 * A development environment cannot be deleted as a site (the server refuses
 * it). Its danger zone deletes the environment instead, then returns to the
 * production site's Development tab.
 */
function DevEnvironmentDangerZone({
  devSite,
  productionId,
}: {
  devSite: SiteRecord
  productionId: string
}) {
  const navigate = useNavigate()
  const dev = useDevEnvironment(productionId, false)
  return (
    <SettingsSection
      title={m.sites_danger_zone()}
      description={m.dev_env_delete_description()}
      danger
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="grid gap-0.5">
          <p className="text-[14px] leading-5 font-medium text-text-primary">
            {m.dev_env_delete()}
          </p>
          <p className="text-callout text-text-secondary">{devSite.name}</p>
        </div>
        <ConfirmDialog
          title={m.dev_env_delete_title()}
          description={m.dev_env_delete_description()}
          confirmLabel={m.dev_env_delete_confirm()}
          variant="destructive"
          testId="dev-env-delete-dialog"
          onConfirm={async () => {
            try {
              await dev.remove.mutateAsync(devSite.id)
              toast.success(m.dev_env_deleted())
              await navigate({
                to: '/sites/$siteId/settings',
                params: { siteId: productionId },
                search: { tab: 'development' },
              })
            } catch (error) {
              toast.error(errorMessage(error))
            }
          }}
        >
          <Button
            type="button"
            variant="outline"
            loading={dev.remove.isPending}
            className="text-text-error hover:bg-status-error-bg hover:text-text-error"
            data-testid="dev-env-delete"
          >
            {dev.remove.isPending ? null : <Trash />}
            {m.dev_env_delete()}
          </Button>
        </ConfirmDialog>
      </div>
    </SettingsSection>
  )
}
