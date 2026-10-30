import * as React from 'react'
import { useQuery } from '@tanstack/react-query'

import { SEO_KEY } from '#/lib/seo'
import { resolvePreviewOwnersFn } from '#/server/fn/content'
import type { ResolvedOwner } from '#/server/content/preview-owners'
import { m } from '#/paraglide/messages'

import { buildTargets, markerForField, otherOwners } from './click-to-edit'
import type { SelfIdentity } from './click-to-edit'
import { highlightMessage, markerKey, modeMessage, ownerKey } from './protocol'
import type {
  HighlightMessage,
  Marker,
  MarkerRect,
  ModeMessage,
  SiteMessage,
} from './protocol'

/** Outline colour when the theme's accent cannot be read as `#rrggbb`. */
const FALLBACK_COLOR = '#5856d6'

/** A field the preview can open: its key and the label its chip shows. */
export type ClickField = { key: string; label: string }

/** A click on an element owned by another entry or section, for the "Open" popover. */
export type OwnerSelection = {
  owner: ResolvedOwner
  label: string
  rect: MarkerRect
}

export type ClickToEditOptions = {
  /** The live channel is on (the entry is saved and has a preview origin). */
  enabled: boolean
  siteId: string
  self: SelfIdentity
  /** Every field the editor shows, SEO included. */
  fields: readonly ClickField[]
  select: boolean
  showAreas: boolean
  /** Full screen: the label follows the cursor. */
  cursorHint: boolean
  post: (message: ModeMessage | HighlightMessage) => void
  onSelectField: (key: string) => void
  onSelectOwner: (selection: OwnerSelection) => void
}

export type ClickToEdit = {
  /** Give every message from the frame here. */
  onSiteMessage: (message: SiteMessage) => void
  /** Call on every iframe load: the new page reports its markers again. */
  onFrameLoad: () => void
  /** Number of markers the preview can open. Zero: no click to edit (Tier 2 or lower). */
  targetCount: number
  /** The page the frame last reported (hello or navigate), or null. */
  pageUrl: string | null
}

/** The theme accent as `#rrggbb`, for the outlines drawn inside the site. */
function accentColor(): string {
  if (typeof window === 'undefined') return FALLBACK_COLOR
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-accent')
    .trim()
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : FALLBACK_COLOR
}

/** "Team › Ana" or "Site content › Footer". */
export function ownerLabel(owner: ResolvedOwner): string {
  return owner.kind === 'entry'
    ? `${owner.collectionLabel} › ${owner.label}`
    : `${m.visual_owner_site_content()} › ${owner.label}`
}

/**
 * Click to edit (docs/design/visual-editor.md, Decisions 12-16), the CMS side.
 * Keeps the markers the page reports, verifies other owners on the server,
 * tells the bridge what it may outline (`mode`), outlines the focused field
 * (`highlight`) and turns clicks into field focus or the "Open" popover.
 */
export function useClickToEdit(options: ClickToEditOptions): ClickToEdit {
  const { enabled, siteId, fields, select, showAreas, cursorHint, post } =
    options
  // Stable across renders while the document is the same.
  const { entryId, globalKey } = options.self
  const self = React.useMemo<SelfIdentity>(
    () => ({ entryId, globalKey }),
    [entryId, globalKey],
  )
  const [markers, setMarkers] = React.useState<Marker[]>([])
  const [pageUrl, setPageUrl] = React.useState<string | null>(null)
  // Bumped on each hello, so the mode is sent again to a new bridge.
  const [bridgeId, setBridgeId] = React.useState(0)

  const latest = React.useRef(options)
  React.useEffect(() => {
    latest.current = options
  })

  const others = React.useMemo(
    () => otherOwners(markers, self),
    [markers, self],
  )
  const ownersQuery = useQuery({
    queryKey: ['preview-owners', siteId, others.map(ownerKey)],
    queryFn: () => resolvePreviewOwnersFn({ data: { siteId, owners: others } }),
    enabled: enabled && others.length > 0,
    staleTime: 60_000,
  })
  const owners = React.useMemo(() => {
    const map = new Map<string, ResolvedOwner | null>()
    const answer = ownersQuery.data
    if (answer)
      others.forEach((owner, i) => map.set(ownerKey(owner), answer[i] ?? null))
    return map
  }, [others, ownersQuery.data])

  const built = React.useMemo(() => {
    const labels = new Map(fields.map((field) => [field.key, field.label]))
    return buildTargets(markers, {
      fieldKeys: fields.map((field) => field.key),
      labelOf: (key) => labels.get(key) ?? key,
      self,
      owners,
      ownerLabel,
    })
  }, [markers, fields, self, owners])

  const builtRef = React.useRef(built)
  builtRef.current = built

  // The bridge only outlines and opens what this list names.
  const targetsKey = JSON.stringify(built.targets)
  React.useEffect(() => {
    if (!enabled || bridgeId === 0) return
    post(
      modeMessage({
        // With nothing to click, Select would only get in the way: the
        // Select/Browse control is hidden then. This effect reruns when targets change.
        select: select && builtRef.current.targets.length > 0,
        showAreas,
        cursorHint,
        color: accentColor(),
        targets: builtRef.current.targets,
      }),
    )
  }, [enabled, bridgeId, select, showAreas, cursorHint, targetsKey, post])

  // Focusing a field in the editor column outlines its element in the preview.
  React.useEffect(() => {
    if (!enabled) return
    const onFocus = (event: FocusEvent) => {
      const node = event.target instanceof Element ? event.target : null
      if (!node?.closest('[data-visual-column]')) return
      const key = node.closest('[data-field]')?.getAttribute('data-field')
      const marker = key ? markerForField(key, builtRef.current) : null
      latest.current.post(highlightMessage(marker))
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [enabled])

  const onSiteMessage = React.useCallback((message: SiteMessage) => {
    switch (message.type) {
      case 'areca:v1:hello':
        setPageUrl(message.url)
        setBridgeId((value) => value + 1)
        return
      case 'areca:v1:navigate':
        setPageUrl(message.url)
        return
      case 'areca:v1:markers':
        setMarkers(message.markers)
        return
      case 'areca:v1:select': {
        const current = builtRef.current
        const key = current.fieldOf.get(
          markerKey({ field: message.field, owner: message.owner }),
        )
        if (key) {
          latest.current.onSelectField(key)
          return
        }
        const owner = message.owner
          ? current.ownerOf.get(ownerKey(message.owner))
          : undefined
        if (owner) {
          latest.current.onSelectOwner({
            owner,
            label: ownerLabel(owner),
            rect: message.rect,
          })
        }
        return
      }
    }
  }, [])

  // A new document reports its URL again (hello or navigate). Until it does,
  // the preview falls back to "stray load" for a page without the bridge.
  const onFrameLoad = React.useCallback(() => {
    setMarkers([])
    setPageUrl(null)
  }, [])

  return {
    onSiteMessage,
    onFrameLoad,
    targetCount: built.targets.length,
    pageUrl,
  }
}

/** The SEO fields a page can mark (`$seo.title`), with the editor's labels. */
export function seoClickFields(): ClickField[] {
  const labels: Record<string, string> = {
    title: m.editor_seo_title(),
    description: m.editor_seo_description(),
    focusKeyphrase: m.editor_seo_keyphrase(),
    ogTitle: m.editor_seo_og_title(),
    ogDescription: m.editor_seo_og_description(),
    ogImage: m.editor_seo_og_image(),
    summary: m.editor_seo_summary(),
    keyTakeaways: m.editor_seo_takeaways(),
    faq: m.editor_seo_faq(),
    about: m.editor_seo_about(),
    author: m.editor_seo_author(),
    canonicalUrl: m.editor_seo_canonical(),
    jsonLd: m.editor_seo_jsonld(),
  }
  return Object.entries(labels).map(([key, label]) => ({
    key: `${SEO_KEY}.${key}`,
    label,
  }))
}
