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
