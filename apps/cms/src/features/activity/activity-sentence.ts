import { humanizeSlug } from '#/lib/admin/helpers'
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
  'member.invite': (target) => m.activity_member_invite({ target }),
  'member.update_role': (target) => m.activity_member_update_role({ target }),
  'member.remove': (target) => m.activity_member_remove({ target }),
  'invitation.revoke': () => m.activity_invitation_revoke(),
  'invitation.resend': () => m.activity_invitation_resend(),
  'setup.completed': () => m.activity_setup_completed(),
  'agency_admin.grant': () => m.activity_agency_admin_grant(),
  'agency_admin.revoke': () => m.activity_agency_admin_revoke(),
  'branding.update': () => m.activity_branding_update(),
  'branding.image_set': () => m.activity_branding_image_set(),
  'branding.image_clear': () => m.activity_branding_image_clear(),
  'branding.reset': () => m.activity_branding_reset(),
  'ai.settings_update': () => m.activity_ai_settings_update(),
  'organization.delete': () => m.activity_organization_delete(),
  'invitation.accept': (target) => m.activity_invitation_accept({ target }),
  'manifest.sync': () => m.activity_manifest_sync(),
  'collection.upsert': (target) => m.activity_collection_upsert({ target }),
  'collection.delete': (target) => m.activity_collection_delete({ target }),
  'mcp_key.create': (target) => m.activity_mcp_key_create({ target }),
  'mcp_key.revoke': (target) => m.activity_mcp_key_revoke({ target }),
  'mcp_connection.create': (target) =>
    m.activity_mcp_connection_create({ target }),
  'mcp_connection.revoke': (target) =>
    m.activity_mcp_connection_revoke({ target }),
  'asset.upload': (target) => m.activity_asset_upload({ target }),
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

/** Splits the sentence around its target so the target can be styled. */
export function activityParts(
  row: ActivityLike,
  entryTitle?: string | null,
): ActivityParts {
  const sentence = SENTENCES[row.action]
  const target = activityTarget(row, entryTitle)
  const siteEvent = SITE_EVENTS.has(row.action)
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
  if (parts.siteEvent || !row.actorName) {
    return body.charAt(0).toUpperCase() + body.slice(1)
  }
  return `${row.actorName} ${body}`
}

/**
 * The name of the MCP key that performed a row's action ("via AI · Laptop"),
 * or null for actions taken in the UI.
 */
export function viaMcpKeyName(row: ActivityLike): string | null {
  const meta = metaOf(row)
  if (meta?.via !== 'mcp') return null
  return text(meta.mcpKeyName)
}

/** Consecutive repeats (the same person, action and target) closer together
 *  than this collapse into one row: autosave writes one "edited" per save. */
export const REPEAT_WINDOW_MS = 15 * 60_000

export type ActivityGroup<T extends ActivityLike> = {
  row: T
  count: number
}

/** Collapses consecutive repeats in a newest-first list. */
export function collapseRepeats<T extends ActivityLike>(
  rows: ReadonlyArray<T>,
) {
  const out: Array<ActivityGroup<T>> = []
  let lastAt = 0
  for (const row of rows) {
    const at = new Date(row.createdAt).getTime()
    const prev = out.at(-1)
    if (
      prev &&
      prev.row.action === row.action &&
      prev.row.targetId === row.targetId &&
      prev.row.actorId === row.actorId &&
      Math.abs(lastAt - at) <= REPEAT_WINDOW_MS
    ) {
      prev.count += 1
    } else {
      out.push({ row, count: 1 })
    }
    lastAt = at
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
