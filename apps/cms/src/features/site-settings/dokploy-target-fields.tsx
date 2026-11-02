import { errorMessage } from '#/lib/admin/helpers'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { Tag } from '#/components/ui/tag'
import { m } from '#/paraglide/messages'

import { TargetCombobox } from './target-combobox'
import type { TargetComboboxGroup } from './target-combobox'
import type {
  DokployApplication,
  useDokployApplications,
} from './use-site-settings'

function statusTone(status: string | null) {
  const value = (status ?? '').toLowerCase()
  if (value === 'done' || value === 'running') return 'success' as const
  if (value === 'error') return 'error' as const
  return 'neutral' as const
}

/**
 * The Dokploy application picker (the shared combobox, fed by the client's
 * applications) and the manual Application ID field kept as a fallback.
 */
export function DokployTargetFields({
  configured,
  applications,
  appId,
  error,
  disabled = false,
  onPick,
  onManualChange,
}: {
  configured: boolean
  applications: ReturnType<typeof useDokployApplications>['applications']
  appId: string
  error?: string
  disabled?: boolean
  onPick: (applicationId: string) => void
  onManualChange: (value: string) => void
}) {
  const list = applications.data?.applications ?? []
  const selected = list.find((app) => app.applicationId === appId)
  const groups: TargetComboboxGroup[] = [
    {
      heading: m.settings_app_title(),
      items: list.map((app: DokployApplication) => ({
        value: app.applicationId,
        testId: `target-option-application-${app.applicationId}`,
        name: app.name,
        detail: app.appName ?? app.applicationId,
        meta: app.applicationStatus ? (
          <Tag tone={statusTone(app.applicationStatus)}>
            {app.applicationStatus}
          </Tag>
        ) : null,
        searchFields: [app.applicationId],
      })),
    },
  ]

  return (
    <div className="grid gap-5">
      {configured ? (
        <TargetCombobox
          label={m.settings_app_title()}
          testId="target-combobox"
          searchTestId="target-combobox-search"
          value={appId || null}
          selectedLabel={selected?.name ?? appId}
          placeholder={m.settings_app_placeholder()}
          groups={groups}
          status={
            applications.data
              ? 'ready'
              : applications.isError
                ? 'error'
                : 'loading'
          }
          error={
            applications.isError
              ? m.settings_app_load_error({
                  error: errorMessage(applications.error),
                })
              : null
          }
          onRetry={() => void applications.refetch()}
          emptyMessage={m.settings_app_none()}
          searchPlaceholder={m.settings_app_search()}
          invalid={Boolean(error)}
          disabled={disabled}
          onSelect={onPick}
        />
      ) : null}

      <FormField
        label={configured ? m.settings_app_manual() : m.sites_application_id()}
        htmlFor="application-id"
        hint={error ? undefined : m.settings_app_manual_hint()}
        error={error}
        trailing={
          appId && configured && applications.isSuccess && !selected ? (
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
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onManualChange(event.target.value)}
        />
      </FormField>
    </div>
  )
}
