import type { DeploymentTarget } from '#/lib/types'

/**
 * The upstream identity of a target: the Dokploy application ID, the Pages
 * project name, or the Worker script tag. Two sites with the same identity on
 * the same connection share one deployment resource.
 */
export function deploymentTargetResourceId(target: DeploymentTarget): string {
  if (target.provider === 'dokploy') return target.applicationId
  return target.kind === 'pages' ? target.projectName : target.scriptTag
}

/**
 * True when the target has everything a production go-live needs. Demo sites
 * and unset targets never do. Callers check this before dispatching.
 */
export function hasCompleteDeploymentTarget(
  target: DeploymentTarget | null | undefined,
): target is DeploymentTarget {
  if (!target || !target.healthCheckUrl) return false
  if (target.provider === 'dokploy') return target.applicationId.length > 0
  if (target.kind === 'pages') {
    return target.projectName.length > 0 && target.branch.length > 0
  }
  return (
    target.scriptName.length > 0 &&
    target.scriptTag.length > 0 &&
    target.triggerUuid.length > 0 &&
    target.branch.length > 0
  )
}

/**
 * Whether two stored targets are the same settings: same provider, same
 * resource, same branch, same health URL. A missing target equals only another
 * missing target. Targets are flat objects, so comparing their fields is enough.
 */
export function sameDeploymentTarget(
  a: DeploymentTarget | null | undefined,
  b: DeploymentTarget | null | undefined,
): boolean {
  if (!a || !b) return !a && !b
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every((key) => left[key] === right[key])
}
