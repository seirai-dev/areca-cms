import {
  Article,
  Briefcase,
  Buildings,
  CalendarBlank,
  EnvelopeSimple,
  File,
  Gear,
  House,
  ImageSquare,
  Palette,
  PlugsConnected,
  Pulse,
  Sparkle,
  Stack,
  Tag,
  User,
  Users,
  UsersThree,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'

import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'

import { isDevSite } from './site-environment'

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

/**
 * The switcher's list: each production site's development environment is
 * nested under it, so only the rest stay at the top level. A dev env whose
 * production site is not in the list stays top-level (it should not happen;
 * showing it is safer than hiding it).
 */
export function nestDevEnvironments(sites: MeSite[]) {
  const productionIds = new Set(
    sites.filter((site) => !isDevSite(site)).map((site) => site.id),
  )
  const devByParent = new Map<string, MeSite>()
  for (const site of sites) {
    if (
      isDevSite(site) &&
      site.parentSiteId !== null &&
      productionIds.has(site.parentSiteId)
    ) {
      devByParent.set(site.parentSiteId, site)
    }
  }
  const nestedIds = new Set([...devByParent.values()].map((site) => site.id))
  return {
    topLevel: sites.filter((site) => !nestedIds.has(site.id)),
    devByParent,
  }
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

export type SiteNavKey =
  'overview' | 'library' | 'connect-ai' | 'people' | 'settings'

export type SiteNavItem = {
  key: SiteNavKey
  label: string
  icon: Icon
  to:
    | '/sites/$siteId'
    | '/sites/$siteId/library'
    | '/sites/$siteId/connect-ai'
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
    {
      key: 'connect-ai',
      label: m.shell_nav_connect_ai(),
      icon: Sparkle,
      to: '/sites/$siteId/connect-ai',
      testId: 'connect-ai-nav',
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
  key:
    | 'overview'
    | 'clients'
    | 'people'
    | 'activity'
    | 'branding'
    | 'ai'
    | 'mail'
    | 'connect-ai'
  label: string
  icon: Icon
  to:
    | '/agency'
    | '/agency/clients'
    | '/agency/people'
    | '/agency/activity'
    | '/agency/branding'
    | '/agency/ai'
    | '/agency/mail'
    | '/agency/connect-ai'
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
    {
      key: 'ai',
      label: m.shell_nav_ai(),
      icon: Sparkle,
      to: '/agency/ai',
      testId: 'agency-ai-nav',
    },
    {
      key: 'mail',
      label: m.shell_nav_mail(),
      icon: EnvelopeSimple,
      to: '/agency/mail',
      testId: 'agency-mail-nav',
    },
    {
      key: 'connect-ai',
      label: m.shell_nav_connect_ai(),
      icon: PlugsConnected,
      to: '/agency/connect-ai',
      testId: 'agency-connect-ai-nav',
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
