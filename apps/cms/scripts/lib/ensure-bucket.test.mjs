import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ensureBucket, isBucketMissing } from './ensure-bucket.mjs'

// Fake S3 client: `headError` and `createError` are returned by the matching
// command, and every call is recorded.
function fakeClient({ headError, createError } = {}) {
  const calls = []
  return {
    calls,
    async send(command) {
      const name = command.constructor.name
      calls.push(name)
      if (name === 'HeadBucketCommand' && headError) throw headError
      if (name === 'CreateBucketCommand' && createError) throw createError
      return {}
    },
  }
}

const httpError = (name, status) =>
  Object.assign(new Error(name), {
    name,
    $metadata: { httpStatusCode: status },
  })

const quiet = { log: () => {} }

test('leaves an existing bucket alone', async () => {
  const client = fakeClient()
  assert.equal(await ensureBucket(client, 'areca', quiet), 'exists')
  assert.deepEqual(client.calls, ['HeadBucketCommand'])
})

test('creates the bucket only after a definitive NotFound', async () => {
  const client = fakeClient({ headError: httpError('NotFound', 404) })
  assert.equal(await ensureBucket(client, 'areca', quiet), 'created')
  assert.deepEqual(client.calls, ['HeadBucketCommand', 'CreateBucketCommand'])
})

test('treats NoSuchBucket as missing too', async () => {
  const client = fakeClient({ headError: httpError('NoSuchBucket', 404) })
  assert.equal(await ensureBucket(client, 'areca', quiet), 'created')
})

test('does not create on access denied', async () => {
  const client = fakeClient({ headError: httpError('Forbidden', 403) })
  await assert.rejects(ensureBucket(client, 'areca', quiet), /Forbidden/)
  assert.deepEqual(client.calls, ['HeadBucketCommand'])
})

test('does not create on a network failure', async () => {
  const client = fakeClient({
    headError: Object.assign(new Error('socket hang up'), {
      name: 'Error',
    }),
  })
  await assert.rejects(ensureBucket(client, 'areca', quiet), /socket hang up/)
  assert.deepEqual(client.calls, ['HeadBucketCommand'])
})

test('does not create on a server error', async () => {
  const client = fakeClient({ headError: httpError('InternalError', 500) })
  await assert.rejects(ensureBucket(client, 'areca', quiet), /InternalError/)
  assert.deepEqual(client.calls, ['HeadBucketCommand'])
})

test('accepts a bucket another instance created in the meantime', async () => {
  const client = fakeClient({
    headError: httpError('NotFound', 404),
    createError: httpError('BucketAlreadyOwnedByYou', 409),
  })
  assert.equal(await ensureBucket(client, 'areca', quiet), 'exists')
})

test('surfaces other create failures', async () => {
  const client = fakeClient({
    headError: httpError('NotFound', 404),
    createError: httpError('BucketAlreadyExists', 409),
  })
  await assert.rejects(
    ensureBucket(client, 'areca', quiet),
    /BucketAlreadyExists/,
  )
})

test('isBucketMissing matches only 404 and NoSuchBucket/NotFound', () => {
  assert.equal(isBucketMissing(httpError('NotFound', 404)), true)
  assert.equal(isBucketMissing(httpError('NoSuchBucket', 404)), true)
  assert.equal(isBucketMissing(httpError('AccessDenied', 403)), false)
  assert.equal(isBucketMissing(httpError('SlowDown', 503)), false)
  assert.equal(isBucketMissing(new Error('ECONNREFUSED')), false)
  assert.equal(isBucketMissing(undefined), false)
})
