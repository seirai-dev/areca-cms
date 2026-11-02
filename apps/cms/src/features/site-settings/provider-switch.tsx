import { Link } from '@tanstack/react-router'
import { ArrowUpRight, CloudArrowUp } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { InsetIcon } from '#/components/ui/inset-list'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { Skeleton } from '#/components/ui/skeleton'
import { Tag } from '#/components/ui/tag'
import { m } from '#/paraglide/messages'

import type { ProviderChoice } from './deployment-target-draft'

/**
 * Dokploy | Cloudflare, with the connection state of the chosen provider. A
 * provider the client has not connected is disabled (Cloudflare only: the
 * Dokploy fallback is a manual application ID, as before). The row links to
 * the client's Deployment settings to set it up.
 */
export function ProviderSwitch({
  value,
  onChange,
  organizationId,
  clientName,
  dokploy,
  cloudflare,
  locked = false,
}: {
  value: ProviderChoice
  onChange: (next: ProviderChoice) => void
  /** A release is pending: the provider cannot change. */
  locked?: boolean
  organizationId: string
  clientName: string
  dokploy: { configured: boolean; pending: boolean; host: string }
  cloudflare: { configured: boolean; pending: boolean }
}) {
  const connected =
    value === 'cloudflare' ? cloudflare.configured : dokploy.configured
  const pending = value === 'cloudflare' ? cloudflare.pending : dokploy.pending

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <SegmentedControl<ProviderChoice>
        fullWidth
        aria-label={m.settings_provider_title()}
        data-testid="deployment-provider"
        value={value}
        onValueChange={onChange}
        options={[
          {
            value: 'dokploy',
            label: m.settings_provider_dokploy(),
            testId: 'deployment-provider-dokploy',
            disabled: locked,
          },
          {
            value: 'cloudflare',
            label: m.settings_provider_cloudflare(),
            testId: 'deployment-provider-cloudflare',
            disabled: locked || !cloudflare.configured,
          },
        ]}
      />
      {!cloudflare.configured && !cloudflare.pending && value === 'dokploy' ? (
        <p
          className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5 text-callout text-text-secondary"
          data-testid="deployment-cloudflare-hint"
        >
          <span>{m.settings_provider_cloudflare_locked()}</span>
          <Link
            to="/agency/clients/$orgId"
            params={{ orgId: organizationId }}
            search={{ tab: 'deployment' }}
            data-testid="deployment-cloudflare-setup-link"
            className="font-medium text-text-accent underline-offset-4 hover:underline"
          >
            {m.settings_provider_cloudflare_setup({ client: clientName })}
          </Link>
        </p>
      ) : null}
      <div
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
        data-testid="deployment-connection"
        data-provider={value}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <InsetIcon
            tone={connected ? 'accent' : 'neutral'}
            className="size-10 rounded-[11px]"
          >
            <CloudArrowUp weight="duotone" />
          </InsetIcon>
          <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-0.5">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[14px] leading-5 font-medium text-text-primary">
              {value === 'cloudflare'
                ? m.settings_provider_cloudflare()
                : m.settings_provider_dokploy()}
              {!pending && connected ? (
                <Tag tone="success">{m.settings_provider_connected_tag()}</Tag>
              ) : null}
            </span>
            <span className="truncate text-callout text-text-secondary">
              {pending ? (
                <Skeleton className="h-4 w-48" />
              ) : connected ? (
                value === 'cloudflare' ? (
                  m.settings_provider_cloudflare_connected({
                    client: clientName,
                  })
                ) : (
                  m.settings_provider_connected({
                    client: clientName,
                    host: dokploy.host,
                  })
                )
              ) : (
                m.settings_provider_not_connected({ client: clientName })
              )}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full sm:w-auto"
          asChild
        >
          <Link
            to="/agency/clients/$orgId"
            params={{ orgId: organizationId }}
            search={{ tab: 'deployment' }}
            data-testid={
              value === 'cloudflare'
                ? 'deployment-cloudflare-connection-link'
                : 'deployment-setup-link'
            }
          >
            {connected
              ? m.settings_provider_manage()
              : value === 'cloudflare'
                ? m.settings_provider_cloudflare_setup({ client: clientName })
                : m.settings_provider_setup({ client: clientName })}
            <ArrowUpRight />
          </Link>
        </Button>
      </div>
    </div>
  )
}
