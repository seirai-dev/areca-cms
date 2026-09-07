export interface DeploymentTarget {
  provider: 'dokploy'
  applicationId: string
  healthCheckUrl: string
}

export interface DeploymentAdapter {
  deploy(
    target: DeploymentTarget,
    log: (line: string) => void,
  ): Promise<{ deploymentId: string }>
  waitForCompletion(
    target: DeploymentTarget,
    deploymentId: string,
    opts: { timeoutMs: number; pollMs: number },
    log: (line: string) => void,
  ): Promise<'done' | 'error' | 'timeout'>
  healthCheck(
    url: string,
    opts: {
      timeoutMs: number
      intervalMs: number
      expectPublicationId?: string
    },
  ): Promise<boolean>
}
