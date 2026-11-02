import type {
  CloudflareBuildTrigger,
  CloudflareDeployTarget,
  CloudflareDeployTargets,
} from '#/adapters/deployment/cloudflare-targets'
import type { DeploymentTarget } from '#/lib/types'

/**
 * The Deployment tab's draft rules, kept free of React so they can be tested
 * on their own: what a Cloudflare pick means, when the saved project is
 * still listed, which target a save sends, and when the health URL follows
 * the suggestion.
 */

export type ProviderChoice = 'dokploy' | 'cloudflare'

/** What the admin picked in the Cloudflare combobox, before it becomes a target. */
export type CloudflareSelection =
  | { kind: 'pages'; name: string; branch: string | null }
  | {
      kind: 'workers'
      name: string
      scriptTag: string
      triggerUuid: string | null
      branch: string | null
    }

export function selectionFromTarget(
  target: DeploymentTarget | null,
): CloudflareSelection | null {
  if (!target || target.provider !== 'cloudflare') return null
  if (target.kind === 'pages') {
    return { kind: 'pages', name: target.projectName, branch: target.branch }
  }
  return {
    kind: 'workers',
    name: target.scriptName,
    scriptTag: target.scriptTag,
    triggerUuid: target.triggerUuid,
    branch: target.branch,
  }
}

/** The selection a listed project gives: the auto-picked trigger for Workers. */
export function selectionFromListed(
  listed: CloudflareDeployTarget,
): CloudflareSelection {
  if (listed.kind === 'pages') {
    return {
      kind: 'pages',
      name: listed.name,
      branch: listed.productionBranch,
    }
  }
  const auto = listed.triggers.find(
    (trigger) => trigger.triggerUuid === listed.autoTriggerUuid,
  )
  return {
    kind: 'workers',
    name: listed.name,
    scriptTag: listed.scriptTag ?? '',
    triggerUuid: auto?.triggerUuid ?? null,
    branch: auto?.branch ?? null,
  }
}

/** Workers only: the chosen trigger sets the branch. Pages ignore it. */
export function withTrigger(
  selection: CloudflareSelection,
  trigger: CloudflareBuildTrigger | null,
): CloudflareSelection {
  if (selection.kind !== 'workers') return selection
  return {
    ...selection,
    triggerUuid: trigger?.triggerUuid ?? null,
    branch: trigger?.branch ?? null,
  }
}

/** The listed project a selection refers to: by name for Pages, tag for Workers. */
export function findListed(
  selection: CloudflareSelection,
  targets: CloudflareDeployTargets,
): CloudflareDeployTarget | null {
  if (selection.kind === 'pages') {
    return (
      targets.pages.find((target) => target.name === selection.name) ?? null
    )
  }
  return (
    targets.workers.find(
      (target) => target.scriptTag === selection.scriptTag,
    ) ?? null
  )
}

/**
 * Whether the saved selection still exists in Cloudflare. A Worker whose
 * saved trigger is gone counts as missing too. `unknown` until the list loads.
 */
export function selectionStatus(
  selection: CloudflareSelection,
  targets: CloudflareDeployTargets | undefined,
): 'found' | 'missing' | 'unknown' {
  if (!targets) return 'unknown'
  const listed = findListed(selection, targets)
  if (!listed) return 'missing'
  if (
    selection.kind === 'workers' &&
    selection.triggerUuid &&
    !listed.triggers.some(
      (trigger) => trigger.triggerUuid === selection.triggerUuid,
    )
  ) {
    return 'missing'
  }
  return 'found'
}

/** The combobox value of a listed project: `pages:<name>` or `workers:<tag>`. */
export function listedValue(target: CloudflareDeployTarget) {
  return target.kind === 'pages'
    ? `pages:${target.name}`
    : `workers:${target.scriptTag ?? ''}`
}

/** The combobox value a selection is shown under. */
export function selectionValue(selection: CloudflareSelection) {
  return selection.kind === 'pages'
    ? `pages:${selection.name}`
    : `workers:${selection.scriptTag}`
}

/**
 * The selection after the admin picks a build trigger. `listed` is the
 * project the selection refers to; an unknown trigger clears the choice.
 */
export function pickTrigger(
  selection: CloudflareSelection,
  listed: CloudflareDeployTarget | null,
  triggerUuid: string,
): CloudflareSelection {
  if (selection.kind !== 'workers') return selection
  const trigger =
    listed?.triggers.find((item) => item.triggerUuid === triggerUuid) ?? null
  return withTrigger(selection, trigger)
}

export type DraftTarget = {
  provider: ProviderChoice
  /** Dokploy only, trimmed. */
  applicationId: string
  /** Cloudflare only. */
  selection: CloudflareSelection | null
  /** Trimmed. */
  healthCheckUrl: string
}

/**
 * The target a save sends, or null. Both providers need a health URL. An
 * incomplete selection (a Worker with no trigger yet) also sends null.
 */
export function buildDeploymentTarget(
  draft: DraftTarget,
): DeploymentTarget | null {
  const { healthCheckUrl } = draft
  if (!healthCheckUrl) return null
  if (draft.provider === 'dokploy') {
    return draft.applicationId
      ? {
          provider: 'dokploy',
          applicationId: draft.applicationId,
          healthCheckUrl,
        }
      : null
  }
  const selection = draft.selection
  if (!selection) return null
  if (selection.kind === 'pages') {
    if (!selection.branch) return null
    return {
      provider: 'cloudflare',
      kind: 'pages',
      projectName: selection.name,
      branch: selection.branch,
      healthCheckUrl,
    }
  }
  if (!selection.scriptTag || !selection.triggerUuid || !selection.branch) {
    return null
  }
  return {
    provider: 'cloudflare',
    kind: 'workers',
    scriptName: selection.name,
    scriptTag: selection.scriptTag,
    triggerUuid: selection.triggerUuid,
    branch: selection.branch,
    healthCheckUrl,
  }
}

/** A stable identity for dirty checks: which thing the site deploys to. */
export function targetIdentity(
  provider: ProviderChoice,
  applicationId: string,
  selection: CloudflareSelection | null,
) {
  if (provider === 'dokploy') return `dokploy:${applicationId}`
  if (!selection) return 'cloudflare:'
  return [
    'cloudflare',
    selection.kind,
    selection.kind === 'pages' ? selection.name : selection.scriptTag,
    selection.kind === 'workers' ? (selection.triggerUuid ?? '') : '',
    selection.branch ?? '',
  ].join(':')
}

/**
 * The health URL after a project is picked. It follows the suggestion when
 * the field is empty or still holds the previous project's suggestion; a
 * URL the admin typed stays. Returns null to keep the current value.
 */
export function nextHealthUrl(input: {
  current: string
  previousSuggestion: string | null
  suggestion: string | null
}): string | null {
  if (!input.suggestion) return null
  const trimmed = input.current.trim()
  if (trimmed === '' || trimmed === input.previousSuggestion) {
    return input.suggestion
  }
  return null
}

/** Case-insensitive match of every query word against any of the fields. */
export function matchesTargetSearch(
  query: string,
  fields: readonly (string | null | undefined)[],
) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = fields
    .filter((field): field is string => Boolean(field))
    .join(' ')
    .toLowerCase()
  return words.every((word) => haystack.includes(word))
}
