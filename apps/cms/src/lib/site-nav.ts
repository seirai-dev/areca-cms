import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'
import {
  Pulse,
  FileText,
  Image,
  Rocket,
  Gear,
  Users,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'

export type SiteSection = {
  key: 'content' | 'media' | 'releases' | 'team' | 'activity' | 'settings'
  label: string
  icon: Icon
  /** Absolute pathname used for active-state matching and plain hrefs. */
  href: string
  /** Match only when the pathname equals `href` (Content also matches nested entry routes). */
  exact?: boolean
  testId?: string
}

export type MeSite = Me['sites'][number]

export function findSite(me: Me, siteId: string | undefined) {
  if (!siteId) return undefined
  return me.sites.find((site) => site.id === siteId)
}

export function isOrgOwner(me: Me, organizationId: string) {
  return me.memberships.some(
    (membership) =>
      membership.organizationId === organizationId &&
      membership.role === 'owner',
  )
}

export function canManageSite(me: Me, organizationId: string) {
  return me.user.isAgencyAdmin || isOrgOwner(me, organizationId)
}

/**
 * Sections available for a site, filtered by what the current user may see.
 * Single source of truth for the sidebar, the in-page tab bar, and breadcrumbs.
 */
export function siteSections(me: Me, site: MeSite): SiteSection[] {
  const base = `/sites/${site.id}`
  const sections: SiteSection[] = [
    {
      key: 'content',
      label: m.shell_nav_content(),
      icon: FileText,
      href: base,
      exact: true,
    },
    {
      key: 'media',
      label: m.shell_nav_media(),
      icon: Image,
      href: `${base}/media`,
    },
    {
      key: 'releases',
      label: m.shell_nav_releases(),
      icon: Rocket,
      href: `${base}/releases`,
    },
  ]

  if (canManageSite(me, site.organizationId)) {
    sections.push(
      {
        key: 'team',
        label: m.shell_nav_team(),
        icon: Users,
        href: `${base}/team`,
        testId: 'team-nav',
      },
      {
        key: 'activity',
        label: m.shell_nav_activity(),
        icon: Pulse,
        href: `${base}/activity`,
        testId: 'org-audit-nav',
      },
    )
  }

  if (me.user.isAgencyAdmin) {
    sections.push({
      key: 'settings',
      label: m.shell_nav_settings(),
      icon: Gear,
      href: `${base}/settings`,
    })
  }

  return sections
}

export function isSectionActive(section: SiteSection, pathname: string) {
  if (section.key === 'content') {
    // Content covers the site overview and every collection/entry route.
    return (
      pathname === section.href || pathname.startsWith(`${section.href}/c/`)
    )
  }
  return pathname === section.href || pathname.startsWith(`${section.href}/`)
}

/** Parse `/sites/:siteId[/...]` and return the site id. */
export function siteIdFromPath(pathname: string) {
  return pathname.match(/^\/sites\/([^/]+)/)?.[1]
}

/** Parse `/sites/:siteId/c/:collectionKey[/...]`. */
export function collectionFromPath(pathname: string) {
  const match = pathname.match(/^\/sites\/[^/]+\/c\/([^/]+)(?:\/([^/]+))?/)
  if (!match) return undefined
  return { collectionKey: match[1], entryId: match[2] }
}

/** True when the user is inside the entry editor (new or existing entry). */
export function isEntryEditorPath(pathname: string) {
  return /^\/sites\/[^/]+\/c\/[^/]+\/[^/]+$/.test(pathname)
}

export function groupSitesByOrg(sites: MeSite[]) {
  const groups = new Map<string, { name: string; sites: MeSite[] }>()
  for (const site of sites) {
    const group = groups.get(site.organizationId) ?? {
      name: site.organizationName,
      sites: [],
    }
    group.sites.push(site)
    groups.set(site.organizationId, group)
  }
  return [...groups.entries()].map(([id, group]) => ({ id, ...group }))
}
