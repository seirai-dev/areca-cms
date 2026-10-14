import {
  isReservedCollectionKey,
  isSafeIdentifier,
} from '#/lib/content-identifiers'
import {
  GLOBAL_PREVIEW_PATH_MAX_LENGTH,
  isValidPreviewPath,
  validateGlobalFields,
} from '#/lib/globals'
import type { ContentKind, Field } from '#/lib/types'
import { m } from '#/paraglide/messages'

import { ValidationError } from './errors.ts'

/** A collection or site content section as the validators see it. */
export type ContentDefinition = {
  key: string
  kind: ContentKind
  fields: Field[]
  enabled?: boolean
}

/**
 * Validates collections and sites together: keys share one namespace, and
 * references may only target enabled collections (never sections).
 */
export function validateContentDefinitions(defs: ContentDefinition[]) {
  const issues: { path: string; message: string }[] = []
  const foldedKeys = new Map<string, string>()
  const activeCollections = new Set(
    defs
      .filter((def) => def.kind === 'collection' && def.enabled !== false)
      .map((def) => def.key),
  )
  for (const def of defs) {
    if (!isSafeIdentifier(def.key))
      issues.push({
        path: def.key,
        message: m.server_unsafe_collection_identifier(),
      })
    else if (isReservedCollectionKey(def.key))
      issues.push({
        path: def.key,
        message: `"${def.key}" is reserved for the generated content API. Choose another key.`,
      })
    const folded = def.key.toLowerCase()
    const previous = foldedKeys.get(folded)
    if (previous !== undefined)
      issues.push({
        path: def.key,
        message: m.server_collection_name_conflict({ key: def.key, previous }),
      })
    foldedKeys.set(folded, def.key)
    if (def.kind === 'global') {
      for (const issue of validateGlobalFields(def.fields))
        issues.push({
          path: `${def.key}.${issue.path}`,
          message: issue.message,
        })
    }
    const keys = new Set<string>()
    for (const field of def.fields) {
      if (!isSafeIdentifier(field.key) || keys.has(field.key))
        issues.push({
          path: `${def.key}.${field.key}`,
          message: m.server_unsafe_or_duplicate_field_identifier(),
        })
      keys.add(field.key)
      if (def.kind === 'collection' && field.group !== undefined)
        issues.push({
          path: `${def.key}.${field.key}`,
          message: 'Only site content fields can have a group heading.',
        })
      for (const reference of [field.collection, field.after]) {
        if (reference !== undefined && !isSafeIdentifier(reference))
          issues.push({
            path: `${def.key}.${field.key}`,
            message: m.server_unsafe_field_reference_identifier(),
          })
      }
      if (
        def.enabled !== false &&
        field.type === 'reference' &&
        (!field.collection || !activeCollections.has(field.collection))
      )
        issues.push({
          path: `${def.key}.${field.key}`,
          message:
            'Choose an existing enabled target collection for this reference field.',
        })
      if (field.after !== undefined) {
        const target = def.fields.find((item) => item.key === field.after)
        if (
          (field.type !== 'date' && field.type !== 'datetime') ||
          !target ||
          target.key === field.key ||
          (target.type !== 'date' && target.type !== 'datetime')
        )
          issues.push({
            path: `${def.key}.${field.key}`,
            message:
              'Date ordering must refer to another existing date or datetime field.',
          })
      }
    }
  }
  if (issues.length) throw new ValidationError(issues)
}

/** Preview paths are checked the same way for the editor and for manifest pushes. */
export function assertPreviewPath(
  path: string | null | undefined,
  key: string,
) {
  if (!path || isValidPreviewPath(path)) return
  throw new ValidationError([
    {
      path: key,
      message: `Preview path must start with a single "/", contain no query or fragment, and be at most ${GLOBAL_PREVIEW_PATH_MAX_LENGTH} characters.`,
    },
  ])
}

/** A key keeps its kind: a collection cannot become a section (or back) under the same key. */
export function assertKindsUnchanged(
  existing: { key: string; kind: ContentKind }[],
  declared: { key: string; kind: ContentKind }[],
) {
  const kinds = new Map(existing.map((row) => [row.key, row.kind]))
  const issues = declared.flatMap((item) => {
    const current = kinds.get(item.key)
    if (current === undefined || current === item.kind) return []
    return [
      {
        path: item.key,
        message: `"${item.key}" is already ${current === 'global' ? 'site content' : 'a collection'} on this site. Delete it before reusing the key.`,
      },
    ]
  })
  if (issues.length) throw new ValidationError(issues)
}
