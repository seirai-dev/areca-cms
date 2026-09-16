import { env } from '#/env'
import { createDokployAdapter } from './deployment/dokploy'
import { createMockDeploymentAdapter } from './deployment/mock'
import { createS3Storage } from './storage/s3'

export function getDeploymentAdapter() {
  if (env.DOKPLOY_API_KEY) {
    return createDokployAdapter({
      baseUrl: env.DOKPLOY_URL,
      apiKey: env.DOKPLOY_API_KEY,
      allowInsecureHttp: env.DOKPLOY_ALLOW_INSECURE_HTTP === 'true',
      allowPrivateHealthChecks: env.ALLOW_PRIVATE_HEALTH_CHECKS === 'true',
    })
  }
  return createMockDeploymentAdapter()
}

export function getStorage() {
  return createS3Storage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
  })
}
