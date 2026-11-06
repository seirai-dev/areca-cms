import type { JSONContent } from '@tiptap/core'

import { richTextDocumentFromJson } from './from-json'

/**
 * Entry links in rich text. A link to an entry is the link mark with
 * `entryId`, `collection` and an optional `anchor` (a section id). Its `href`
 * is the target's path when it was saved; the snapshot replaces it with the
 * target's path in the language of the text (docs/design/rich-text-links.md).
 *
 * Pure: no database imports. The callers decide what a target resolves to.
 */

export type EntryLinkTarget = { entryId: string; anchor: string | null }

/**
 * What a target resolves to. `href` is null when the link cannot work (the
 * target is not live, or does not exist). `reason` is set for every problem
 * worth a warning. A missing section keeps the link to the page.
 */
export type EntryLinkResolution = {
  href: string | null
  reason?: 'not-live' | 'missing' | 'missing-section'
  targetTitle: string
  /** Set when the stored collection key should change (the save check). */
  collection?: string
}

/** One problem with one link, as the resolver reported it. */
export type EntryLinkIssue = EntryLinkTarget & {
  reason: 'not-live' | 'missing' | 'missing-section'
  targetTitle: string
}

type Node = JSONContent & {
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

function linkMarkOf(node: Node) {
  return node.marks?.find(
    (mark) => mark.type === 'link' && typeof mark.attrs?.entryId === 'string',
  )
}

function anchorOf(mark: { attrs?: Record<string, unknown> }): string | null {
  const anchor = mark.attrs?.anchor
  return typeof anchor === 'string' && anchor !== '' ? anchor : null
}

/** Every entry link mark in a rich text document, one per occurrence in order. */
export function entryLinkTargets(json: unknown): EntryLinkTarget[] {
  const out: EntryLinkTarget[] = []
  const stack: unknown[] = [json]
  while (stack.length > 0) {
    const node = stack.pop() as Node | null
    if (!node || typeof node !== 'object') continue
    const mark = linkMarkOf(node)
    if (mark) {
      out.push({ entryId: String(mark.attrs?.entryId), anchor: anchorOf(mark) })
    }
    if (Array.isArray(node.content)) {
      for (let i = node.content.length - 1; i >= 0; i--)
        stack.push(node.content[i])
    }
  }
  return out
}

/**
 * The rich text with every entry link resolved. Returns a copy; `json` is not
 * mutated. A link that cannot work loses its link mark and keeps its text.
 * `issues` lists each distinct problem once.
 */
export async function resolveEntryLinks(
  json: unknown,
  resolve: (target: EntryLinkTarget) => Promise<EntryLinkResolution>,
): Promise<{ json: JSONContent; issues: EntryLinkIssue[] }> {
  const copy = structuredClone(json) as JSONContent
  const issues: EntryLinkIssue[] = []
  const seen = new Set<string>()
  const cache = new Map<string, Promise<EntryLinkResolution>>()
  const stack: Node[] = [copy]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (
      node.marks?.some(
        (mark) =>
          mark.type === 'link' && typeof mark.attrs?.entryId === 'string',
      )
    ) {
      const kept: NonNullable<Node['marks']> = []
      for (const mark of node.marks) {
        if (mark.type !== 'link' || typeof mark.attrs?.entryId !== 'string') {
          kept.push(mark)
          continue
        }
        const target: EntryLinkTarget = {
          entryId: mark.attrs.entryId,
          anchor: anchorOf(mark),
        }
        const key = `${target.entryId}#${target.anchor ?? ''}`
        let pending = cache.get(key)
        if (!pending) {
          pending = resolve(target)
          cache.set(key, pending)
        }
        const result = await pending
        if (result.reason) {
          const issueKey = `${key}|${result.reason}`
          if (!seen.has(issueKey)) {
            seen.add(issueKey)
            issues.push({
              ...target,
              reason: result.reason,
              targetTitle: result.targetTitle,
            })
          }
        }
        if (result.href === null) continue
        kept.push({
          ...mark,
          attrs: {
            ...mark.attrs,
            href: result.href,
            ...(result.collection !== undefined
              ? { collection: result.collection }
              : {}),
          },
        })
      }
      node.marks = kept.length > 0 ? kept : undefined
    }
    if (Array.isArray(node.content)) stack.push(...(node.content as Node[]))
  }
  return { json: copy, issues }
}

/**
 * Re-points entry links to other ids (a dev environment maps ids on fork and
 * push). A link whose id cannot be mapped loses its mark and keeps its text;
 * its old id is returned in `cleared`. Synchronous: no lookups, no database.
 */
export function remapEntryLinks(
  json: unknown,
  lookup: (entryId: string) => string | undefined,
): { json: JSONContent; cleared: string[] } {
  const copy = structuredClone(json) as JSONContent
  const cleared: string[] = []
  const stack: Node[] = [copy]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (
      node.marks?.some(
        (mark) =>
          mark.type === 'link' && typeof mark.attrs?.entryId === 'string',
      )
    ) {
      const kept: NonNullable<Node['marks']> = []
      for (const mark of node.marks) {
        if (mark.type !== 'link' || typeof mark.attrs?.entryId !== 'string') {
          kept.push(mark)
          continue
        }
        const next = lookup(mark.attrs.entryId)
        if (next === undefined) {
          cleared.push(mark.attrs.entryId)
          continue
        }
        kept.push({ ...mark, attrs: { ...mark.attrs, entryId: next } })
      }
      node.marks = kept.length > 0 ? kept : undefined
    }
    if (Array.isArray(node.content)) stack.push(...(node.content as Node[]))
  }
  return { json: copy, cleared }
}

/** Heading ids in one rich text value, as the published `document` has them, at any depth. */
export function richTextHeadingIds(json: unknown): string[] {
  if (!json || typeof json !== 'object') return []
  const document = richTextDocumentFromJson(json)
  const ids: string[] = []
  const stack: unknown[] = [document]
  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      // Reversed, so the items pop in document order.
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i])
      continue
    }
    if (!node || typeof node !== 'object') continue
    const block = node as { type?: unknown; id?: unknown }
    if (block.type === 'heading' && typeof block.id === 'string')
      ids.push(block.id)
    const values = Object.values(node)
    for (let i = values.length - 1; i >= 0; i--) stack.push(values[i])
  }
  return ids
}
