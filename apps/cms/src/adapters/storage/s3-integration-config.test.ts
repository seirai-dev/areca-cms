import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as S3 from './s3'

const { createS3Storage, registerTest } = vi.hoisted(() => ({
  createS3Storage: vi.fn(),
  registerTest: vi.fn(),
}))

vi.mock('./s3', async (importOriginal) => {
  const actual = await importOriginal<typeof S3>()
  createS3Storage.mockImplementation(actual.createS3Storage)
  return { ...actual, createS3Storage }
})

afterEach(() => {
  vi.doUnmock('vitest')
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  vi.resetModules()
})

async function loadIntegrationSuite(prefix: string | undefined) {
  vi.stubEnv('S3_ENDPOINT', 'http://s3.invalid')
  vi.stubEnv('S3_REGION', 'us-east-1')
  vi.stubEnv('S3_BUCKET', 'test-bucket')
  vi.stubEnv('S3_ACCESS_KEY', 'fake-access')
  vi.stubEnv('S3_SECRET_KEY', 'fake-secret')
  vi.stubEnv('S3_FORCE_PATH_STYLE', 'true')
  vi.stubEnv('S3_PREFIX', prefix)
  // Collect the real suite's configuration without registering or executing
  // its live object operations. Skipped suites also execute their callback.
  vi.doMock('vitest', () => ({
    describe: {
      skipIf: () => (_name: string, collect: () => void) => collect(),
    },
    it: registerTest,
    expect,
  }))
  return import('./s3.test')
}

describe('live S3 suite configuration', () => {
  it.each([undefined, '', '/tenant/staging/'])(
    'forwards S3_PREFIX %j to the adapter',
    async (prefix) => {
      await loadIntegrationSuite(prefix)
      expect(createS3Storage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ prefix }),
      )
      expect(registerTest).toHaveBeenCalledTimes(2)
    },
  )

  it('rejects invalid configuration before registering live operations', async () => {
    await expect(loadIntegrationSuite('///')).rejects.toThrow(/prefix/i)
    expect(registerTest).not.toHaveBeenCalled()
  })
})
