import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { adminQueryKeys, suggestSlug } from '#/lib/admin/helpers'
import { errorMessage } from '#/lib/errors'
import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { useShell } from '#/components/shell/shell-context'
import { SlideOver } from '#/components/ui/slide-over'
import { useStepUp } from '#/features/security/step-up'
import { TokenReveal } from '#/features/site-settings/token-reveal'
import {
  removePendingToken,
  writePendingToken,
} from '#/lib/pending-site-tokens'
import type { PendingToken } from '#/lib/pending-site-tokens'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { createSiteFn } from '#/server/fn/admin'

import { SlugField } from './slug-field'

/** The local demo site, suggested only while developing. */
const DEMO_SITE_URL = 'http://localhost:3001'
const DEFAULT_PRODUCTION_URL = import.meta.env.DEV ? DEMO_SITE_URL : ''

/** Create a site in a client; refreshes every list that shows sites. */
function useCreateSite(orgId: string) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const stepUp = useStepUp()
  return useMutation({
    mutationFn: (input: {
      name: string
      slug: string
      productionUrl: string
    }) =>
      stepUp.run(() =>
        createSiteFn({ data: { organizationId: orgId, ...input } }),
      ),
    onSuccess: async () => {
      toast.success(m.admin_org_toast_site_created())
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminQueryKeys.sites(orgId),
        }),
        queryClient.invalidateQueries({
          queryKey: adminQueryKeys.organizations,
        }),
        queryClient.invalidateQueries({ queryKey: ['sites-overview'] }),
        // `me.sites` feeds the sidebar and the switcher.
        router.invalidate(),
      ])
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
}

function StepDots({ step }: { step: 1 | 2 }) {
  return (
    <div
      className="flex items-center gap-2 text-caption font-normal text-text-muted"
      aria-hidden="true"
    >
      {[1, 2].map((value) => (
        <span
          key={value}
          className={cn(
            'h-1 rounded-full transition-all duration-200',
            value === step ? 'w-6 bg-accent' : 'w-3 bg-border-strong',
          )}
        />
      ))}
      <span className="ml-1 tnum">{m.agency_step_of({ step, total: 2 })}</span>
    </div>
  )
}

/**
 * New site, a two-step sheet (brief §3.11):
 *   1. name, short name (slug) and address
 *   2. "Connect your site": the one-time token and env snippet, "I've saved it"
 *
 * Closing step 2 without confirming keeps the token as a card on the Sites
 * tab (`onUnconfirmed`) so it is never lost by a stray click.
 */
export function NewSiteSheet({
  orgId,
  open,
  onOpenChange,
  onUnconfirmed,
}: {
  orgId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onUnconfirmed: (pending: PendingToken) => void
}) {
  const [name, setName] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [slugTouched, setSlugTouched] = React.useState(false)
  const [productionUrl, setProductionUrl] = React.useState(
    DEFAULT_PRODUCTION_URL,
  )
  const [created, setCreated] = React.useState<PendingToken | null>(null)
  const { me } = useShell()
  const create = useCreateSite(orgId)

  function reset() {
    setName('')
    setSlug('')
    setSlugTouched(false)
    setProductionUrl(DEFAULT_PRODUCTION_URL)
    setCreated(null)
  }

  function close(confirmed: boolean) {
    if (created && !confirmed) onUnconfirmed(created)
    if (created && confirmed)
      removePendingToken(me.user.id, orgId, created.siteId)
    onOpenChange(false)
    // Let the exit animation play before clearing the form.
    setTimeout(reset, 250)
  }

  const step = created ? 2 : 1

  return (
    <SlideOver
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true)
        else if (!create.isPending) close(false)
      }}
      title={step === 1 ? m.agency_new_site() : m.agency_connect_site_title()}
      description={
        step === 1
          ? m.agency_new_site_description()
          : m.agency_connect_site_description({ site: created?.siteName ?? '' })
      }
      data-testid="new-site-sheet"
      footer={
        step === 1 ? (
          <div className="flex items-center justify-between gap-2">
            <StepDots step={1} />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => close(false)}
                disabled={create.isPending}
              >
                {m.admin_cancel()}
              </Button>
              <Button
                type="submit"
                form="new-site-form"
                loading={create.isPending}
                data-testid="create-site"
              >
                {m.admin_org_create_site()}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <StepDots step={2} />
            <Button
              type="button"
              onClick={() => close(true)}
              data-testid="token-saved"
            >
              {m.agency_token_saved()}
            </Button>
          </div>
        )
      }
    >
      {step === 1 ? (
        <form
          id="new-site-form"
          className="grid gap-5 pt-2"
          onSubmit={(event) => {
            event.preventDefault()
            const siteName = name.trim()
            create.mutate(
              {
                name: siteName,
                slug: slug.trim(),
                productionUrl: productionUrl.trim(),
              },
              {
                onSuccess: (site) => {
                  const pending = {
                    siteId: site.id,
                    siteName,
                    token: site.token,
                    schemaToken: site.schemaToken,
                  }
                  // Survives a reload until "I've saved it".
                  writePendingToken(me.user.id, orgId, pending)
                  setCreated(pending)
                },
              },
            )
          }}
        >
          <FormField label={m.agency_site_name()} htmlFor="site-name">
            <Input
              id="site-name"
              data-testid="site-name"
              required
              autoFocus
              autoComplete="off"
              placeholder={m.agency_site_name_placeholder()}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (!slugTouched) setSlug(suggestSlug(event.target.value))
              }}
            />
          </FormField>
          <SlugField
            id="site-slug"
            testId="site-slug"
            value={slug}
            onChange={setSlug}
            touched={slugTouched}
            onTouched={() => setSlugTouched(true)}
            hint={m.agency_site_slug_hint()}
          />
          <FormField
            label={m.admin_org_production_url()}
            htmlFor="site-production-url"
            hint={
              import.meta.env.DEV
                ? m.agency_site_url_hint({ url: DEMO_SITE_URL })
                : m.settings_production_url_hint()
            }
          >
            <Input
              id="site-production-url"
              data-testid="site-production-url"
              type="url"
              required
              placeholder="https://www.example.com"
              value={productionUrl}
              onChange={(event) => setProductionUrl(event.target.value)}
            />
          </FormField>
        </form>
      ) : created ? (
        <div className="grid gap-4 pt-2">
          <TokenReveal token={created.token} />
          {created.schemaToken ? (
            <TokenReveal token={created.schemaToken} privilege="schema" />
          ) : null}
          <p className="px-1 text-callout text-text-secondary">
            {m.agency_connect_site_next()}
          </p>
        </div>
      ) : null}
    </SlideOver>
  )
}
