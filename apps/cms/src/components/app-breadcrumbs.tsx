import { Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'

import { queryKeys } from '#/components/editor/query-keys'
import { entryTitle } from '#/components/editor/utils'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '#/components/ui/breadcrumb'
import type { EntryData } from '#/lib/types'
import { cn } from '#/lib/utils'
import {
  collectionFromPath,
  findSite,
  siteIdFromPath,
  siteSections,
} from '#/lib/site-nav'
import { getEntryFn, listCollectionsFn } from '#/server/fn/content'
import type { Me } from '#/server/fn/me'

type Crumb = { label: string; href?: string }

function orgName(me: Me, orgId: string) {
  return (
    me.memberships.find((m) => m.organizationId === orgId)?.organizationName ??
    me.sites.find((s) => s.organizationId === orgId)?.organizationName ??
    'Organization'
  )
}

/**
 * Breadcrumbs derived from the current pathname. Every level is a link except
 * the last. On small screens only the last two crumbs are shown so a long
 * site or entry title never wraps the header.
 */
export function AppBreadcrumbs({ me }: { me: Me }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const siteId = siteIdFromPath(pathname)
  const site = findSite(me, siteId)
  const collectionRef = collectionFromPath(pathname)

  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(site?.id ?? ''),
    queryFn: () => listCollectionsFn({ data: { siteId: site!.id } }),
    enabled: Boolean(site && collectionRef),
  })
  const collection = collectionsQuery.data?.find(
    (item) => item.key === collectionRef?.collectionKey,
  )

  const entryId =
    collectionRef?.entryId && collectionRef.entryId !== 'new'
      ? collectionRef.entryId
      : undefined
  const entryQuery = useQuery({
    queryKey: queryKeys.entry(entryId ?? 'new'),
    queryFn: () => getEntryFn({ data: { id: entryId! } }),
    enabled: Boolean(entryId),
  })

  const crumbs: Crumb[] = [{ label: 'Dashboard', href: '/' }]

  if (site) {
    crumbs.push({ label: site.name, href: `/sites/${site.id}` })
    const section = siteSections(me, site).find(
      (item) =>
        item.key !== 'content' &&
        item.href.startsWith(`/sites/${site.id}/`) &&
        pathname.startsWith(item.href),
    )
    if (section) {
      crumbs.push({ label: section.label, href: section.href })
    }
    if (collectionRef) {
      crumbs.push({
        label: collection?.label ?? collectionRef.collectionKey,
        href: `/sites/${site.id}/c/${collectionRef.collectionKey}`,
      })
      if (collectionRef.entryId === 'new') {
        crumbs.push({ label: 'New entry' })
      } else if (collectionRef.entryId) {
        const entry = entryQuery.data as
          { slug: string; draftData: EntryData } | undefined
        crumbs.push({
          label: entry
            ? entryTitle(entry.draftData, collection?.fields ?? [], entry.slug)
            : 'Entry',
        })
      }
    }
  } else if (pathname.startsWith('/admin')) {
    crumbs.push({ label: 'Agency', href: '/admin/organizations' })
    const orgMatch = pathname.match(/^\/admin\/organizations\/([^/]+)/)
    if (orgMatch) {
      crumbs.push({ label: 'Organizations', href: '/admin/organizations' })
      crumbs.push({ label: orgName(me, orgMatch[1]) })
    } else if (pathname.startsWith('/admin/organizations')) {
      crumbs.push({ label: 'Organizations' })
    } else if (pathname.startsWith('/admin/users')) {
      crumbs.push({ label: 'Users' })
    } else if (pathname.startsWith('/admin/audit')) {
      crumbs.push({ label: 'Audit log' })
    } else if (pathname.startsWith('/admin/branding')) {
      crumbs.push({ label: 'Branding' })
    }
  } else {
    const orgMatch = pathname.match(/^\/orgs\/([^/]+)\/(members|audit)/)
    if (orgMatch) {
      crumbs.push({ label: orgName(me, orgMatch[1]) })
      crumbs.push({ label: orgMatch[2] === 'members' ? 'Team' : 'Activity' })
    }
  }

  const last = crumbs.length - 1

  return (
    <Breadcrumb className="min-w-0 flex-1">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => {
          const isLast = index === last
          // Keep only the last two crumbs on small screens.
          const hideOnMobile = index < last - 1
          return (
            <Fragment key={`${crumb.label}-${index}`}>
              {index > 0 ? (
                <BreadcrumbSeparator
                  className={cn(
                    index < last ? 'hidden md:block' : undefined,
                    index === last && 'block',
                  )}
                />
              ) : null}
              <BreadcrumbItem
                className={cn(
                  'min-w-0',
                  hideOnMobile && 'hidden md:inline-flex',
                )}
              >
                {isLast || !crumb.href ? (
                  <BreadcrumbPage className="truncate" title={crumb.label}>
                    {crumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link
                      to={crumb.href}
                      className="truncate"
                      title={crumb.label}
                    >
                      {crumb.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
