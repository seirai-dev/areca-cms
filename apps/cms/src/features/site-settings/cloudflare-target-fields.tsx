import type { UseQueryResult } from '@tanstack/react-query'

import type {
  CloudflareBuildTrigger,
  CloudflareDeployTarget,
  CloudflareDeployTargets,
} from '#/adapters/deployment/cloudflare-targets'
import { errorMessage } from '#/lib/admin/helpers'
import { FormField } from '#/components/ui/form-field'
import { m } from '#/paraglide/messages'

import {
  findListed,
  listedValue,
  selectionStatus,
  selectionValue,
} from './deployment-target-draft'
import type { CloudflareSelection } from './deployment-target-draft'
import { TargetCombobox } from './target-combobox'
import type { TargetComboboxGroup, TargetComboboxItem } from './target-combobox'

function disabledCopy(reason: CloudflareDeployTarget['disabledReason']) {
  if (reason === 'no_git') return m.settings_cloudflare_no_git()
  if (reason === 'no_builds') return m.settings_cloudflare_no_builds()
  if (reason === 'no_production_trigger')
    return m.settings_cloudflare_no_production_trigger()
  return null
}

function triggerLabel(trigger: CloudflareBuildTrigger) {
  const name = trigger.name ? ` · ${trigger.name}` : ''
  const preview = trigger.preview
    ? ` · ${m.settings_cloudflare_trigger_preview()}`
    : ''
  return `${trigger.branch}${name}${preview}`
}

function toItem(target: CloudflareDeployTarget): TargetComboboxItem {
  return {
    value: listedValue(target),
    testId: `target-option-${target.kind}-${target.name}`,
    name: target.name,
    detail: target.productionBranch,
    domain: target.primaryDomain,
    disabledReason: disabledCopy(target.disabledReason),
    searchFields: [target.kind === 'pages' ? 'pages' : 'workers'],
  }
}

/**
 * The Cloudflare half of the target: one combobox with Pages and Workers
 * groups, the branch the build follows, a trigger select for Workers with
 * more than one matching trigger, and a warning when the saved project is no
 * longer in the account.
 */
export function CloudflareTargetFields({
  enabled,
  clientName,
  targets,
  selection,
  error,
  disabled = false,
  onPick,
  onPickTrigger,
}: {
  enabled: boolean
  clientName: string
  targets: UseQueryResult<CloudflareDeployTargets>
  selection: CloudflareSelection | null
  error?: string
  disabled?: boolean
  onPick: (target: CloudflareDeployTarget) => void
  onPickTrigger: (triggerUuid: string) => void
}) {
  const data = targets.data
  const groups: TargetComboboxGroup[] = data
    ? [
        {
          heading: m.settings_cloudflare_group_pages(),
          items: data.pages.map(toItem),
        },
        {
          heading: m.settings_cloudflare_group_workers(),
          items: data.workers.map(toItem),
        },
      ]
    : []
  const status = !enabled
    ? 'idle'
    : data
      ? 'ready'
      : targets.isError
        ? 'error'
        : 'loading'
  const listed = selection && data ? findListed(selection, data) : null
  const missing = selection
    ? selectionStatus(selection, data) === 'missing'
    : false
  const triggers = listed?.kind === 'workers' ? listed.triggers : []

  return (
    <div className="grid gap-5">
      <TargetCombobox
        label={m.settings_cloudflare_project_title()}
        testId="target-combobox"
        searchTestId="target-combobox-search"
        value={selection ? selectionValue(selection) : null}
        selectedLabel={selection?.name}
        placeholder={m.settings_cloudflare_choose()}
        groups={groups}
        status={status}
        idleMessage={m.settings_cloudflare_not_connected_body({
          client: clientName,
        })}
        emptyMessage={
          data && data.pages.length + data.workers.length === 0
            ? m.settings_cloudflare_none()
            : m.settings_cloudflare_empty()
        }
        searchPlaceholder={m.settings_cloudflare_search()}
        error={
          targets.isError
            ? m.settings_cloudflare_load_error({
                error: errorMessage(targets.error),
              })
            : null
        }
        onRetry={() => void targets.refetch()}
        onRefresh={enabled ? () => void targets.refetch() : undefined}
        refreshing={targets.isFetching}
        refreshLabel={m.settings_cloudflare_refresh()}
        invalid={Boolean(error)}
        disabled={disabled}
        onSelect={(value) => {
          const target = data
            ? [...data.pages, ...data.workers].find(
                (item) => listedValue(item) === value,
              )
            : undefined
          if (target) onPick(target)
        }}
      />

      {missing ? (
        <p
          role="status"
          data-testid="cloudflare-target-missing"
          className="rounded-control bg-status-warning-bg px-3 py-2.5 text-callout text-text-warning"
        >
          {m.settings_cloudflare_not_found()}
        </p>
      ) : null}

      {selection?.branch ? (
        <p
          data-testid="cloudflare-target-branch"
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-0.5 text-callout text-text-secondary"
        >
          <span>{m.settings_cloudflare_branch_label()}</span>
          <span className="min-w-0 truncate font-mono text-[13px] text-text-primary">
            {selection.branch}
          </span>
        </p>
      ) : null}

      {selection?.kind === 'workers' && triggers.length > 1 ? (
        <FormField
          label={m.settings_cloudflare_trigger_label()}
          htmlFor="cloudflare-trigger"
          hint={m.settings_cloudflare_trigger_hint()}
        >
          <select
            id="cloudflare-trigger"
            data-testid="cloudflare-trigger-select"
            value={selection.triggerUuid ?? ''}
            disabled={disabled}
            onChange={(event) => onPickTrigger(event.target.value)}
            className="h-10 w-full min-w-0 rounded-control border border-border-default bg-background-surface px-3 font-mono text-[13px] text-text-primary"
          >
            {selection.triggerUuid ? null : (
              <option value="">{m.settings_cloudflare_trigger_choose()}</option>
            )}
            {triggers.map((trigger) => (
              <option
                key={trigger.triggerUuid}
                value={trigger.triggerUuid}
                disabled={trigger.preview}
              >
                {triggerLabel(trigger)}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}
    </div>
  )
}
