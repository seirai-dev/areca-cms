import {
  Article,
  Briefcase,
  Buildings,
  CalendarBlank,
  File,
  Gear,
  House,
  ImageSquare,
  Palette,
  Pulse,
  Stack,
  Tag,
  User,
  Users,
  UsersThree,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'

import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'

/**
 * Navigation model for the shell (brief §2, §2.1). One source of truth for
 * the sidebar, the mobile tab bar and sheets, and the command palette.
 */

export type MeSite = Me['sites'][number]

export type SiteRole = 'admin' | 'owner' | 'editor'

export function findSite(me: Me, siteId: string | undefined) {
  if (!siteId) return undefined
  return me.sites.find((site) => site.id === siteId)
}

function isOrgOwner(me: Me, organizationId: string) {
  return me.memberships.some(
    (membership) =>
      membership.organizationId === organizationId &&
      membership.role === 'owner',
  )
}

/** Owners and agency admins: publish, People, Activity. */
export function canManageSite(me: Me, organizationId: string) {
  return me.user.isAgencyAdmin || isOrgOwner(me, organizationId)
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

/** "https://www.acme.com/" → "acme.com". */
export function displayHost(url: string | null | undefined) {
  if (!url) return ''
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  }
}

/* -------------------------------------------------------------------------
   Site workspace
------------------------------------------------------------------------- */

export type SiteNavKey = 'overview' | 'library' | 'people' | 'settings'

export type SiteNavItem = {
  key: SiteNavKey
  label: string
  icon: Icon
  to:
    | '/sites/$siteId'
    | '/sites/$siteId/library'
    | '/sites/$siteId/people'
    | '/sites/$siteId/settings'
  /** Match only the exact path (Overview). */
  exact?: boolean
  testId?: string
  /** Keyboard shortcut after `g`. */
  shortcut?: string
}

/** Site workspace pages the current user may open, in sidebar order. */
export function siteNavItems(me: Me, site: MeSite): SiteNavItem[] {
  const items: SiteNavItem[] = [
    {
      key: 'overview',
      label: m.shell_nav_overview(),
      icon: House,
      to: '/sites/$siteId',
      exact: true,
      testId: 'overview-nav',
      shortcut: 'o',
    },
    {
      key: 'library',
      label: m.shell_nav_library(),
      icon: ImageSquare,
      to: '/sites/$siteId/library',
      testId: 'library-nav',
      shortcut: 'l',
    },
  ]
  if (canManageSite(me, site.organizationId)) {
    items.push({
      key: 'people',
      label: m.shell_nav_people(),
      icon: Users,
      to: '/sites/$siteId/people',
      // Kept from the old Team tab so existing tests keep their anchor.
      testId: 'team-nav',
      shortcut: 'p',
    })
  }
  if (me.user.isAgencyAdmin) {
    items.push({
      key: 'settings',
      label: m.shell_nav_settings(),
      icon: Gear,
      to: '/sites/$siteId/settings',
      testId: 'settings-nav',
    })
  }
  return items
}

/* -------------------------------------------------------------------------
   Agency workspace
------------------------------------------------------------------------- */

export type AgencyNavItem = {
  key: 'overview' | 'clients' | 'people' | 'activity' | 'branding'
  label: string
  icon: Icon
  to:
    | '/agency'
    | '/agency/clients'
    | '/agency/people'
    | '/agency/activity'
    | '/agency/branding'
  exact?: boolean
  testId?: string
}

export function agencyNavItems(): AgencyNavItem[] {
  return [
    {
      key: 'overview',
      label: m.shell_nav_overview(),
      icon: House,
      to: '/agency',
      exact: true,
      testId: 'agency-overview-nav',
    },
    {
      key: 'clients',
      label: m.shell_nav_clients(),
      icon: Buildings,
      to: '/agency/clients',
      testId: 'clients-nav',
    },
    {
      key: 'people',
      label: m.shell_nav_people(),
      icon: UsersThree,
      to: '/agency/people',
      testId: 'agency-people-nav',
    },
    {
      key: 'activity',
      label: m.shell_nav_activity(),
      icon: Pulse,
      to: '/agency/activity',
      testId: 'agency-activity-nav',
    },
    {
      key: 'branding',
      label: m.shell_nav_branding(),
      icon: Palette,
      to: '/agency/branding',
      testId: 'branding-nav',
    },
  ]
}

/* -------------------------------------------------------------------------
   Collections
------------------------------------------------------------------------- */

/**
 * One consistent icon per collection, chosen by key heuristics (brief §4.4).
 */
export function collectionIcon(key: string, label = ''): Icon {
  const text = `${key} ${label}`.toLowerCase()
  if (/blog|article|post|news|story|stories/.test(text)) return Article
  if (/page/.test(text)) return File
  if (/job|vacanc|career/.test(text)) return Briefcase
  if (/event|agenda|calendar/.test(text)) return CalendarBlank
  if (/product|shop|item/.test(text)) return Tag
  if (/team|person|people|member|author|staff/.test(text)) return User
  return Stack
}

/**
 * "Articles" → "Article", "Categories" → "Category". A simple English
 * heuristic (brief §3.4); callers fall back to "entry" when it returns null.
 */
export function singularLabel(label: string): string | null {
  const trimmed = label.trim()
  if (!trimmed) return null
  if (/ies$/i.test(trimmed)) return `${trimmed.slice(0, -3)}y`
  if (/(ss|us|is)$/i.test(trimmed)) return null
  if (/s$/i.test(trimmed)) return trimmed.slice(0, -1)
  return null
}

/** "New article", or "New entry" when no singular can be derived. */
export function newEntryLabel(collectionLabel: string) {
  const singular = singularLabel(collectionLabel)
  return singular
    ? m.shell_new_singular({ name: singular.toLowerCase() })
    : m.shell_new_entry()
}

/* -------------------------------------------------------------------------
   Paths (for code outside route components)
------------------------------------------------------------------------- */
