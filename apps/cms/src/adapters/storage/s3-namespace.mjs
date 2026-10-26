/** @param {unknown} logicalKey */
export function isValidLogicalKey(logicalKey) {
  // SDK/HTTP URL normalization must never turn an object request into a
  // request outside the namespace. Percent characters are encoded by S3's
  // serializer; do not URL-decode keys here.
  return (
    typeof logicalKey === 'string' &&
    !/[\p{Cc}\\]/u.test(logicalKey) &&
    !logicalKey
      .split('/')
      .some((part) => !part || part === '.' || part === '..')
  )
}

/**
 * S3 names are physical only at the storage boundary. Database and bundle keys
 * stay logical, even when they happen to start with the configured prefix.
 * @param {string | undefined} rawPrefix
 */
export function createS3Namespace(rawPrefix) {
  let prefix = ''
  if (rawPrefix !== undefined && rawPrefix !== '') {
    if (typeof rawPrefix !== 'string' || /[\s\p{Cc}\\]/u.test(rawPrefix))
      throw new Error(
        'Invalid S3_PREFIX: whitespace, controls and backslashes are forbidden',
      )
    prefix = rawPrefix.replace(/^\/+|\/+$/g, '')
    if (
      !prefix ||
      prefix.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error(
        'Invalid S3_PREFIX: expected nonempty path segments without . or ..',
      )
  }
  const listPrefix = prefix ? `${prefix}/` : undefined
  return {
    prefix,
    listPrefix,
    /** @param {string} logicalKey */
    objectKey(logicalKey) {
      if (!isValidLogicalKey(logicalKey))
        throw new Error('Invalid S3 logical object key')
      return listPrefix ? `${listPrefix}${logicalKey}` : logicalKey
    },
    /** Listings already contain physical keys; never map them again.
     * @param {string} physicalKey
     */
    containsPhysicalKey(physicalKey) {
      return (
        typeof physicalKey === 'string' &&
        (!listPrefix || physicalKey.startsWith(listPrefix))
      )
    },
  }
}
