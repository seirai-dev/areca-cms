import { humanizeSlug, membershipRoleLabel } from '#/lib/admin/helpers'
import type { MembershipRole } from '#/lib/types'
import { m } from '#/paraglide/messages'

/**
 * Activity rows as plain-language sentences (brief §3.7, §0 "language is
 * human"): "Sanne marked “Spring launch” as ready", "Acme Website went
 * live". Pure, so the Activity panel, the Agency activity page and the Agency
 * overview share one vocabulary.
 */

export type ActivityLike = {
  id: string
  action: string
  targetType: string
  targetId: string
  actorId: string | null
  actorName: string | null
  organizationId?: string | null
  organizationName: string | null
  siteName: string | null
  meta: unknown
  createdAt: string | Date
}

/** Marks where the target goes inside a translated sentence. */
export const TARGET_MARK = '\u0000'

type Sentence = (target: string) => string

const SENTENCES: Partial<Record<string, Sentence>> = {
  'entry.create': (target) => m.activity_entry_create({ target }),
  'entry.update': (target) => m.activity_entry_update({ target }),
  'entry.restore': (target) => m.activity_entry_restore({ target }),
  'entry.publish': (target) => m.activity_entry_publish({ target }),
  'entry.unpublish': (target) => m.activity_entry_unpublish({ target }),
  'entry.archive': (target) => m.activity_entry_archive({ target }),
  'entry.schedule': (target) => m.activity_entry_schedule({ target }),
  'entry.cancel_schedule': (target) =>
    m.activity_entry_cancel_schedule({ target }),
  'entry.discard': (target) => m.activity_entry_discard({ target }),
  'entry.delete': (target) => m.activity_entry_delete({ target }),
  'entry.ai_seo_generate': (target) =>
    m.activity_entry_ai_seo_generate({ target }),
  'publication.requested': () => m.activity_publication_requested(),
  'publication.rollback_requested': () =>
    m.activity_publication_rollback_requested(),
  'publication.live': (target) => m.activity_publication_live({ target }),
  'publication.failed': (target) => m.activity_publication_failed({ target }),
  'publication.scheduled_failed': () =>
    m.activity_publication_scheduled_failed(),
  'build_job.cancelled': () => m.activity_build_job_cancelled(),
  'site.create': (target) => m.activity_site_create({ target }),
  'site.update': (target) => m.activity_site_update({ target }),
  'site.rotate_token': (target) => m.activity_site_rotate_token({ target }),
  'site.delete': (target) => m.activity_site_delete({ target }),
  'organization.create': (target) => m.activity_organization_create({ target }),
  'organization.update': (target) => m.activity_organization_update({ target }),
  'organization.dokploy_credentials_created': (target) =>
    m.activity_organization_dokploy_created({ target }),
  'organization.dokploy_credentials_updated': (target) =>
    m.activity_organization_dokploy_updated({ target }),
  'organization.dokploy_credentials_removed': (target) =>
    m.activity_organization_dokploy_removed({ target }),
  'organization.dokploy_credentials_verified': (target) =>
    m.activity_organization_dokploy_verified({ target }),
  'organization.dokploy_credentials_validation_failed': (target) =>
    m.activity_organization_dokploy_failed({ target }),
  'organization.cloudflare_credentials_created': (target) =>
    m.activity_organization_cloudflare_created({ target }),
  'organization.cloudflare_credentials_updated': (target) =>
    m.activity_organization_cloudflare_updated({ target }),
  'organization.cloudflare_credentials_removed': (target) =>
    m.activity_organization_cloudflare_removed({ target }),
  'organization.cloudflare_credentials_verified': (target) =>
    m.activity_organization_cloudflare_verified({ target }),
  'organization.cloudflare_credentials_validation_failed': (target) =>
    m.activity_organization_cloudflare_failed({ target }),
  'member.invite': (target) => m.activity_member_invite({ target }),
  'member.update_role': (target) => m.activity_member_update_role({ target }),
  'member.remove': (target) => m.activity_member_remove({ target }),
  'member.add': (target) => m.activity_member_add({ target }),
  'user.block': (target) => m.activity_user_block({ target }),
  'user.unblock': (target) => m.activity_user_unblock({ target }),
  'user.delete': (target) => m.activity_user_delete({ target }),
  'user.rename': (target) => m.activity_user_rename({ target }),
  'user.sign_in': () => m.activity_user_sign_in(),
  'user.sessions_revoke': (target) =>
    m.activity_user_sessions_revoke({ target }),
  'user.two_factor_reset': (target) =>
    m.activity_user_two_factor_reset({ target }),
  'invitation.revoke': () => m.activity_invitation_revoke(),
  'invitation.regenerate_link': () => m.activity_invitation_regenerate_link(),
  'invitation.resend': () => m.activity_invitation_resend(),
  'setup.completed': () => m.activity_setup_completed(),
  'agency_admin.grant': () => m.activity_agency_admin_grant(),
  'agency_admin.revoke': () => m.activity_agency_admin_revoke(),
  'branding.update': () => m.activity_branding_update(),
  'branding.image_set': () => m.activity_branding_image_set(),
  'branding.image_clear': () => m.activity_branding_image_clear(),
  'branding.reset': () => m.activity_branding_reset(),
  'ai.settings_update': () => m.activity_ai_settings_update(),
  'mail_settings.update': () => m.activity_mail_settings_update(),
  'mail_settings.use_env': () => m.activity_mail_settings_use_env(),
  'organization.delete': () => m.activity_organization_delete(),
  'invitation.accept': (target) => m.activity_invitation_accept({ target }),
  'manifest.sync': () => m.activity_manifest_sync(),
  'collection.upsert': (target) => m.activity_collection_upsert({ target }),
  'collection.delete': (target) => m.activity_collection_delete({ target }),
  'global.upsert': (target) => m.activity_global_upsert({ target }),
  'global.set_enabled': (target) => m.activity_global_set_enabled({ target }),
  'global.delete': (target) => m.activity_global_delete({ target }),
  'mcp_key.create': (target) => m.activity_mcp_key_create({ target }),
  'mcp_key.revoke': (target) => m.activity_mcp_key_revoke({ target }),
  'mcp_connection.create': (target) =>
    m.activity_mcp_connection_create({ target }),
  'mcp_connection.revoke': (target) =>
    m.activity_mcp_connection_revoke({ target }),
  'asset.upload': (target) => m.activity_asset_upload({ target }),
  'asset.update': (target) => m.activity_asset_update({ target }),
  'asset.delete': (target) => m.activity_asset_delete({ target }),
  'dev_env.fork': () => m.activity_dev_env_fork(),
  'dev_env.refresh': () => m.activity_dev_env_refresh(),
  'dev_env.copy_entry': (target) => m.activity_dev_env_copy_entry({ target }),
  'dev_env.delete': () => m.activity_dev_env_delete(),
}

/** The counts a push row stores that make up "changes" (see the push plan). */
const PUSH_CHANGE_KEYS = ['schema', 'new', 'changed', 'archived'] as const

function pushedChangeCount(meta: Record<string, unknown> | null) {
  let total = 0
  for (const key of PUSH_CHANGE_KEYS) {
    const value = meta?.[key]
    if (typeof value === 'number') total += value
  }
  return total
}

/** Events the system reports about the site, told without an actor. */
const SITE_EVENTS = new Set([
  'publication.live',
  'publication.failed',
  'publication.scheduled_failed',
])

function metaOf(row: ActivityLike) {
  return row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
    ? (row.meta as Record<string, unknown>)
    : null
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

/** The thing the sentence is about: a name when known, else a generic word. */
export function activityTarget(
  row: ActivityLike,
  entryTitle?: string | null,
): { label: string; named: boolean } {
  const meta = metaOf(row)
  const named = (label: string | null) =>
    label ? { label, named: true } : null
  switch (row.targetType) {
    case 'entry': {
      const slug = text(meta?.slug)
      return (
        named(entryTitle ?? null) ??
        named(slug ? humanizeSlug(slug) : null) ?? {
          label: m.activity_target_entry(),
          named: false,
        }
      )
    }
    case 'publication':
      return (
        named(row.siteName) ?? {
          label: m.activity_target_site(),
          named: false,
        }
      )
    case 'site':
      return (
        named(row.siteName) ?? {
          label: m.activity_target_site(),
          named: false,
        }
      )
    case 'organization':
      return (
        named(row.organizationName) ?? {
          label: m.activity_target_client(),
          named: false,
        }
      )
    case 'invitation':
      if (row.action === 'invitation.accept') {
        return (
          named(row.organizationName) ?? {
            label: m.activity_target_client(),
            named: false,
          }
        )
      }
      return (
        named(text(meta?.email)) ?? {
          label: m.activity_target_person(),
          named: false,
        }
      )
    case 'membership':
      return (
        named(text(meta?.email)) ?? {
          label: m.activity_target_person(),
          named: false,
        }
      )
    case 'user':
      return (
        named(text(meta?.userName) ?? text(meta?.deletedUserName)) ?? {
          label: m.activity_target_person(),
          named: false,
        }
      )
    case 'mcp_key':
      return (
        named(text(meta?.name)) ?? {
          label: m.activity_target_ai_key(),
          named: false,
        }
      )
    case 'mcp_connection':
      return (
        named(text(meta?.clientName)) ?? {
          label: m.activity_target_ai_app(),
          named: false,
        }
      )
    case 'asset':
      return (
        named(text(meta?.filename) ?? text(meta?.originalFilename)) ?? {
          label: m.activity_target_asset(),
          named: false,
        }
      )
    case 'collection':
      return (
        named(
          text(meta?.label) ?? text(meta?.key) ?? text(meta?.collectionKey),
        ) ?? {
          label: m.activity_target_content_type(),
          named: false,
        }
      )
    default:
      return { label: row.targetType, named: false }
  }
}

export type ActivityParts = {
  /** Sentence text before the target. */
  before: string
  /** The target, or null when the sentence has none. */
  target: string | null
  /** Whether the target is a real name (shown in the primary colour). */
  named: boolean
  after: string
  /** Told without an actor ("Acme Website went live"). */
  siteEvent: boolean
}

function roleOf(value: unknown): MembershipRole | null {
  return value === 'owner' || value === 'editor' ? value : null
}

/**
 * Sentences that name the person, client and role from the row's own meta,
 * as they were when the row was written (so a later rename or deletion does not
 * rewrite history). Returns null when the meta lacks what the sentence needs,
 * and the generic sentence is used instead.
 */
function namedSentence(row: ActivityLike): string | null {
  const meta = metaOf(row)
  const client = row.organizationName ?? m.activity_a_client()
  switch (row.action) {
    case 'user.sign_in':
      return m.activity_user_sign_in()
    case 'user.rename': {
      const from = text(meta?.previousName)
      const to = text(meta?.userName)
      return from && to ? m.activity_user_rename_full({ from, to }) : null
    }
    case 'member.update_role': {
      const role = roleOf(meta?.role)
      if (!role) return null
      const roleName = membershipRoleLabel(role)
      const person = text(meta?.userName)
      return person
        ? m.activity_member_update_role_full({ person, client, role: roleName })
        : m.activity_member_update_role_anon({ client, role: roleName })
    }
    case 'dev_env.rename': {
      const slug = text(meta?.slug)
      return slug ? m.activity_dev_env_rename({ slug }) : null
    }
    case 'dev_env.push': {
      const count = pushedChangeCount(meta)
      return count === 1
        ? m.activity_dev_env_push_one({ count })
        : m.activity_dev_env_push_other({ count })
    }
    case 'member.add': {
      const person = text(meta?.userName) ?? text(meta?.email)
      const role = roleOf(meta?.role)
      if (!role) {
        return person ? m.activity_member_add_plain({ person, client }) : null
      }
      const roleName = membershipRoleLabel(role)
      return person
        ? m.activity_member_add_full({ person, client, role: roleName })
        : m.activity_member_add_anon({ client, role: roleName })
    }
    default:
      return null
  }
}

/** Splits the sentence around its target so the target can be styled. */
export function activityParts(
  row: ActivityLike,
  entryTitle?: string | null,
): ActivityParts {
  const siteEvent = SITE_EVENTS.has(row.action)
  const named = namedSentence(row)
  if (named !== null) {
    return { before: named, target: null, named: false, after: '', siteEvent }
  }
  const sentence = SENTENCES[row.action]
  const target = activityTarget(row, entryTitle)
  if (!sentence) {
    // Unknown action: its key, made readable.
    return {
      before: `${row.action.replace(/[._]/g, ' ')} `,
      target: target.named ? target.label : null,
      named: target.named,
      after: '',
      siteEvent,
    }
  }
  const marked = sentence(TARGET_MARK)
  const at = marked.indexOf(TARGET_MARK)
  if (at === -1) {
    return { before: marked, target: null, named: false, after: '', siteEvent }
  }
  return {
    before: marked.slice(0, at),
    // Titles read best quoted; site, client and people names do not.
    target:
      target.named && (row.targetType === 'entry' || row.targetType === 'asset')
        ? `“${target.label}”`
        : target.label,
    named: target.named,
    after: marked.slice(at + TARGET_MARK.length),
    siteEvent,
  }
}

/** Plain text of a row, for labels and tests. */
export function activityText(row: ActivityLike, entryTitle?: string | null) {
  const parts = activityParts(row, entryTitle)
  const body = `${parts.before}${parts.target ?? ''}${parts.after}`
  // An actor who has since been deleted is kept by name in the row's meta.
  const actorName = row.actorName ?? text(metaOf(row)?.actorName)
  if (parts.siteEvent || !actorName) {
    return body.charAt(0).toUpperCase() + body.slice(1)
  }
  return `${actorName} ${body}`
}

/**
 * The MCP key that performed a row's action ("via AI · Laptop"), and whether
 * it came through the agency connector. Null for actions taken in the UI.
 */
export function viaMcpKey(
  row: ActivityLike,
): { name: string | null; agency: boolean } | null {
  const meta = metaOf(row)
  if (meta?.via !== 'mcp' && meta?.via !== 'mcp-agency') return null
  return { name: text(meta.mcpKeyName), agency: meta.via === 'mcp-agency' }
}

/** Consecutive repeats (the same person, action and target) closer together
 *  than this collapse into one row: autosave writes one "edited" per save. */
export const REPEAT_WINDOW_MS = 15 * 60_000

export type ActivityGroup<T extends ActivityLike> = {
  row: T
  count: number
}

/** When a shared autosave row (see `auditAutosave`) took its last save. */
export function lastSavedAt(row: ActivityLike) {
  const value = metaOf(row)?.lastSavedAt
  if (typeof value !== 'string') return null
  return Number.isNaN(new Date(value).getTime()) ? null : value
}

/**
 * Autosaves share one row (see `auditAutosave`): `meta.saves` counts them,
 * `createdAt` is the first one and `meta.lastSavedAt` the newest. Rows written
 * before that moved `createdAt` to the newest save and kept the first in
 * `meta.firstSavedAt`. Other rows are one event at `createdAt`.
 */
function repeatsOf(row: ActivityLike) {
  const meta = metaOf(row)
  const created = new Date(row.createdAt).getTime()
  const saves = meta?.saves
  if (typeof saves !== 'number' || saves < 1)
    return { count: 1, at: created, firstAt: created }
  const last = lastSavedAt(row)
  const first =
    typeof meta?.firstSavedAt === 'string'
      ? new Date(meta.firstSavedAt).getTime()
      : NaN
  return {
    count: saves,
    at: last ? new Date(last).getTime() : created,
    firstAt: Number.isNaN(first) ? created : Math.min(first, created),
  }
}

/** Collapses consecutive repeats in a newest-first list. */
export function collapseRepeats<T extends ActivityLike>(
  rows: ReadonlyArray<T>,
) {
  const out: Array<ActivityGroup<T>> = []
  let lastAt = 0
  for (const row of rows) {
    const { count, at, firstAt } = repeatsOf(row)
    const prev = out.at(-1)
    if (
      prev &&
      prev.row.action === row.action &&
      prev.row.targetId === row.targetId &&
      prev.row.actorId === row.actorId &&
      Math.abs(lastAt - at) <= REPEAT_WINDOW_MS
    ) {
      prev.count += count
    } else {
      out.push({ row, count })
    }
    lastAt = firstAt
  }
  return out
}

/** Entry ids whose titles make the sentences readable. */
export function entryTargetIds(rows: ReadonlyArray<ActivityLike>) {
  const ids = new Set<string>()
  for (const row of rows) {
    if (row.targetType === 'entry' && row.action !== 'entry.delete') {
      ids.add(row.targetId)
    }
  }
  return [...ids]
}

/** Where an event happened: "Northwind Studio · Journal", or just the site
 *  when its name already says the client ("Acme Website", not "Acme · Acme
 *  Website"). */
export function activityScope(row: {
  organizationName: string | null
  siteName: string | null
  /** Explicit null marks an instance-level event (no organization). */
  organizationId?: string | null
}) {
  const org = row.organizationName?.trim()
  const site = row.siteName?.trim()
  if (row.organizationId === null && !org && !site) {
    return m.activity_scope_instance()
  }
  if (org && site && site.toLowerCase().startsWith(org.toLowerCase())) {
    return site
  }
  return [org, site].filter(Boolean).join(' · ')
}
