import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3'

/**
 * True only for the definitive answer that the bucket does not exist: an S3
 * NotFound/NoSuchBucket or any 404. Access denied (403), server errors and
 * network failures are not this answer, so they never lead to a create.
 */
export function isBucketMissing(error) {
  const status = error?.$metadata?.httpStatusCode
  const name = error?.name ?? error?.Code
  return status === 404 || name === 'NotFound' || name === 'NoSuchBucket'
}

/**
 * Makes sure `bucket` exists. A bucket is created only after HeadBucket
 * definitively reports it missing. Any other failure is thrown, so a caller
 * that retries never creates a bucket on a guess.
 *
 * @param {import('@aws-sdk/client-s3').S3Client} client
 * @param {string} bucket
 * @param {{ log?: (message: string) => void, timeoutMs?: number }} [options]
 * @returns {Promise<'exists' | 'created'>}
 */
export async function ensureBucket(
  client,
  bucket,
  { log = console.log, timeoutMs = 10_000 } = {},
) {
  // Bounded per call, so a stalled endpoint cannot hold the startup.
  const options = { abortSignal: AbortSignal.timeout(timeoutMs) }
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }), options)
    log(`bucket already exists: ${bucket}`)
    return 'exists'
  } catch (error) {
    if (!isBucketMissing(error)) throw error
  }

  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }), options)
  } catch (error) {
    // Another instance created it between our HeadBucket and CreateBucket.
    if (error?.name === 'BucketAlreadyOwnedByYou') {
      log(`bucket already exists: ${bucket}`)
      return 'exists'
    }
    throw error
  }
  log(`created bucket: ${bucket}`)
  return 'created'
}
