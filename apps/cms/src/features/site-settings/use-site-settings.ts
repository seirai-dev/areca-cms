import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

import { invalidateDevSync } from '#/features/dev-env/invalidate'
import { useStepUp } from '#/features/security/step-up'
import { queryKeys } from '#/lib/query-keys'
import { cloudflareStatusQuery } from '#/features/agency/queries'
import {
  changeSiteSlugFn,
  deleteSiteFn,
  getDokployCredentialStatusFn,
  getSiteFn,
  listCloudflareDeployTargetsFn,
  rotateSiteTokenFn,
  setSiteLanguagesFn,
  updateSiteFn,
  verifyDokployCredentialsFn,
} from '#/server/fn/admin'

export type SiteRecord = Awaited<ReturnType<typeof getSiteFn>>
export type DokployApplication = Awaited<
  ReturnType<typeof verifyDokployCredentialsFn>
>['applications'][number]
export type CloudflareDeployTargets = Awaited<
  ReturnType<typeof listCloudflareDeployTargetsFn>
>

/** The full site record (admins only) plus the settings mutations. */
export function useSiteSettings(siteId: string) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const getSite = useServerFn(getSiteFn)
  const updateSite = useServerFn(updateSiteFn)
  const setLanguagesFn = useServerFn(setSiteLanguagesFn)
  const changeSlugFn = useServerFn(changeSiteSlugFn)
  const rotateSiteToken = useServerFn(rotateSiteTokenFn)
  const deleteSite = useServerFn(deleteSiteFn)
  const stepUp = useStepUp()

  const site = useQuery({
    queryKey: queryKeys.site(siteId),
    queryFn: () => getSite({ data: { id: siteId } }),
  })

  const refresh = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.site(siteId),
      }),
      // Languages and name changes on a development site change its unpushed count.
      invalidateDevSync(queryClient, siteId),
    ])
    // Name and URL also live in `me.sites` (sidebar, switcher).
    await router.invalidate()
  }, [queryClient, router, siteId])

  const update = useMutation({
    mutationFn: (patch: Omit<Parameters<typeof updateSite>[0]['data'], 'id'>) =>
      updateSite({ data: { id: siteId, ...patch } }),
    onSuccess: refresh,
  })

  // The slug is the site key: the connector URL and `--site-key` use it.
  const changeSlug = useMutation({
    mutationFn: (slug: string) => changeSlugFn({ data: { id: siteId, slug } }),
    onSuccess: refresh,
  })

  const setLanguages = useMutation({
    mutationFn: (input: { main: string; all: string[] }) =>
      setLanguagesFn({ data: { id: siteId, ...input } }),
    onSuccess: refresh,
  })

  const rotate = useMutation({
    mutationFn: (privilege: 'build' | 'schema' = 'build') =>
      stepUp.run(() => rotateSiteToken({ data: { id: siteId, privilege } })),
  })

  const remove = useMutation({
    mutationFn: () => stepUp.run(() => deleteSite({ data: { id: siteId } })),
  })

  return { site, update, changeSlug, setLanguages, rotate, remove }
}

/**
 * The client's Dokploy connection and, when connected, its applications
 * (brief §3.10 Application picker). Listing calls Dokploy, so it runs once
 * per visit and is cached for a minute.
 */
export function useDokployApplications(organizationId: string) {
  const getStatus = useServerFn(getDokployCredentialStatusFn)
  const verify = useServerFn(verifyDokployCredentialsFn)
  const status = useQuery({
    queryKey: queryKeys.dokployCredentials(organizationId),
    queryFn: () => getStatus({ data: { organizationId } }),
  })
  const applications = useQuery({
    queryKey: queryKeys.dokployApplications(organizationId),
    queryFn: () => verify({ data: { organizationId } }),
    enabled: status.data?.configured === true,
    staleTime: 60_000,
    retry: false,
  })
  return { status, applications }
}

/**
 * The client's Cloudflare Pages projects and Workers. Listing calls
 * Cloudflare, so it runs only when the connection is configured, and it is
 * cached for a minute. `refetch` ignores the cache (the refresh button).
 */
export function useCloudflareDeployTargets(
  organizationId: string,
  enabled: boolean,
) {
  const list = useServerFn(listCloudflareDeployTargetsFn)
  return useQuery({
    queryKey: queryKeys.cloudflareDeployTargets(organizationId),
    queryFn: () => list({ data: { organizationId } }),
    enabled,
    staleTime: 60_000,
    retry: false,
  })
}

/** The client's Cloudflare connection status (shared with the agency card). */
export function useCloudflareConnection(organizationId: string) {
  return useQuery(cloudflareStatusQuery(organizationId))
}

/**
 * The site's languages for admin screens that are not the settings page
 * (the schema editor). Shares the settings query, so a save there is seen
 * here. `null` on a single-language site.
 */
export function useSiteLanguages(siteId: string, enabled = true) {
  const getSite = useServerFn(getSiteFn)
  const query = useQuery({
    queryKey: queryKeys.site(siteId),
    queryFn: () => getSite({ data: { id: siteId } }),
    enabled,
  })
  return query.data?.languages ?? null
}
