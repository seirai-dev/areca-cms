import * as React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { errorMessage } from '#/components/admin/helpers'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { SettingsSection } from '#/components/ui/settings-section'
import { m } from '#/paraglide/messages'

import { SettingsSaveBar } from './settings-save-bar'
import type { SiteRecord, useSiteSettings } from './use-site-settings'

function isUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Settings › General: name, production URL, and the danger zone. */
export function GeneralTab({
  site,
  settings,
}: {
  site: SiteRecord
  settings: ReturnType<typeof useSiteSettings>
}) {
  const navigate = useNavigate()
  const formId = React.useId()
  const [name, setName] = React.useState(site.name)
  const [url, setUrl] = React.useState(site.productionUrl)
  const [errors, setErrors] = React.useState<{ name?: string; url?: string }>({})

  // Follow the server copy until the user starts editing.
  React.useEffect(() => setName(site.name), [site.name])
  React.useEffect(() => setUrl(site.productionUrl), [site.productionUrl])

  const dirty = name !== site.name || url !== site.productionUrl

  function discard() {
    setName(site.name)
    setUrl(site.productionUrl)
    setErrors({})
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    const next = { name: name.trim(), url: url.trim() }
    const problems: typeof errors = {}
    if (!next.name) problems.name = m.settings_name_required()
    if (!isUrl(next.url)) problems.url = m.settings_url_invalid()
    setErrors(problems)
    if (problems.name || problems.url) return
    try {
      await settings.update.mutateAsync({ name: next.name, productionUrl: next.url })
      setName(next.name)
      setUrl(next.url)
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
          <FormField label={m.sites_name()} htmlFor="settings-site-name" error={errors.name}>
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
            label={m.sites_production_url()}
            htmlFor="settings-production-url"
            hint={errors.url ? undefined : m.settings_production_url_hint()}
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
        </SettingsSection>
      </form>

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
            <Button type="button" variant="destructive" data-testid="delete-site">
              <Trash />
              {m.settings_delete_button()}
            </Button>
          </ConfirmDialog>
        </div>
      </SettingsSection>

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
