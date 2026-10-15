import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

import { useStepUp } from '#/features/security/step-up'
import { adminQueryKeys } from '#/lib/admin/helpers'
import {
  deleteSiteFn,
  getDokployCredentialStatusFn,
  getSiteFn,
  rotateSiteTokenFn,
  setSiteLanguagesFn,
  updateSiteFn,
  verifyDokployCredentialsFn,
} from '#/server/fn/admin'

export type SiteRecord = Awaited<ReturnType<typeof getSiteFn>>
export type DokployApplication = Awaited<
  ReturnType<typeof verifyDokployCredentialsFn>
>['applications'][number]

/** The full site record (admins only) plus the settings mutations. */
export function useSiteSettings(siteId: string) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const getSite = useServerFn(getSiteFn)
  const updateSite = useServerFn(updateSiteFn)
  const setLanguagesFn = useServerFn(setSiteLanguagesFn)
  const rotateSiteToken = useServerFn(rotateSiteTokenFn)
  const deleteSite = useServerFn(deleteSiteFn)
  const stepUp = useStepUp()

  const site = useQuery({
    queryKey: adminQueryKeys.site(siteId),
    queryFn: () => getSite({ data: { id: siteId } }),
  })

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: adminQueryKeys.site(siteId),
    })
    // Name and URL also live in `me.sites` (sidebar, switcher).
    await router.invalidate()
  }, [queryClient, router, siteId])

  const update = useMutation({
    mutationFn: (patch: Omit<Parameters<typeof updateSite>[0]['data'], 'id'>) =>
      updateSite({ data: { id: siteId, ...patch } }),
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

  return { site, update, setLanguages, rotate, remove }
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
    queryKey: adminQueryKeys.dokployCredentials(organizationId),
    queryFn: () => getStatus({ data: { organizationId } }),
  })
  const applications = useQuery({
    queryKey: [
      ...adminQueryKeys.dokployCredentials(organizationId),
      'applications',
    ],
    queryFn: () => verify({ data: { organizationId } }),
    enabled: status.data?.configured === true,
    staleTime: 60_000,
    retry: false,
  })
  return { status, applications }
}

/**
 * The site's languages for admin screens that are not the settings page
 * (the schema editor). Shares the settings query, so a save there is seen
 * here. `null` on a single-language site.
 */
export function useSiteLanguages(siteId: string, enabled = true) {
  const getSite = useServerFn(getSiteFn)
  const query = useQuery({
    queryKey: adminQueryKeys.site(siteId),
    queryFn: () => getSite({ data: { id: siteId } }),
    enabled,
  })
  return query.data?.languages ?? null
}
