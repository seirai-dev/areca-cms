import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const VERSION = 'v1'

function decodeKey(encodedKey: string) {
  const key = Buffer.from(encodedKey, 'base64')
  if (key.length !== KEY_BYTES || key.toString('base64') !== encodedKey) {
    throw new Error(
      'DOKPLOY_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    )
  }
  return key
}

export function encryptSecret(
  plaintext: string,
  encodedKey: string,
  context: string,
) {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, decodeKey(encodedKey), iv)
  cipher.setAAD(Buffer.from(context, 'utf8'))
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.')
}

export function decryptSecret(
  payload: string,
  encodedKey: string,
  context: string,
) {
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] =
    payload.split('.')
  if (
    version !== VERSION ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    extra
  ) {
    throw new Error('Encrypted secret has an unsupported format')
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      decodeKey(encodedKey),
      Buffer.from(encodedIv, 'base64'),
    )
    decipher.setAAD(Buffer.from(context, 'utf8'))
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch (error) {
    if (error instanceof Error && error.message.includes('must be a base64')) {
      throw error
    }
    throw new Error('Encrypted secret could not be decrypted')
  }
}
