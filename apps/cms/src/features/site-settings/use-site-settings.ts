import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

import { adminQueryKeys } from '#/components/admin/helpers'
import {
  deleteSiteFn,
  getDokployCredentialStatusFn,
  getSiteFn,
  rotateSiteTokenFn,
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
  const rotateSiteToken = useServerFn(rotateSiteTokenFn)
  const deleteSite = useServerFn(deleteSiteFn)

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

  const rotate = useMutation({
    mutationFn: () => rotateSiteToken({ data: { id: siteId } }),
  })

  const remove = useMutation({
    mutationFn: () => deleteSite({ data: { id: siteId } }),
  })

  return { site, update, rotate, remove }
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
