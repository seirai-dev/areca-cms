import { m } from '#/paraglide/messages'
import { readLimitedBody, UploadTooLargeError } from '#/server/http/upload'

import { AssetValidationError, assetUrl, MAX_SIZE_BYTES } from './index'
import {
  finishSessionByToken,
  publicSessionInfo,
  sessionState,
  uploadToSession,
  UploadSessionError,
} from './upload-sessions'

/** Room for a little framing on top of the 20 MiB file. */
const MAX_BODY_BYTES = MAX_SIZE_BYTES + 64 * 1024
const FILENAME_MAX_LENGTH = 200

const NO_STORE = { 'Cache-Control': 'no-store' }

function errorResponse(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status, headers: NO_STORE })
}

function decode(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return decodeURIComponent(value).slice(0, FILENAME_MAX_LENGTH)
  } catch {
    return value.slice(0, FILENAME_MAX_LENGTH)
  }
}

/**
 * The stored file name: the last path segment (`curl -T photo.jpg <url>/`
 * appends it), else the X-Filename header the upload page sends, else
 * `?filename=`.
 */
function filenameFor(request: Request, pathFilename?: string): string | null {
  return (
    decode(pathFilename) ??
    decode(request.headers.get('x-filename')) ??
    decode(new URL(request.url).searchParams.get('filename'))
  )
}

function failure(error: unknown): Response {
  if (error instanceof UploadSessionError) {
    return errorResponse(error.status, error.code, error.message)
  }
  if (error instanceof UploadTooLargeError) {
    return errorResponse(413, 'too_large', m.server_file_exceeds_20mb())
  }
  if (error instanceof AssetValidationError) {
    return errorResponse(400, 'invalid_file', error.message)
  }
  throw error
}

/** PUT: one file per request, the raw bytes as the body. */
export async function handleSessionUpload(
  request: Request,
  token: string,
  pathFilename?: string,
): Promise<Response> {
  try {
    const result = await uploadToSession({
      token,
      filename: filenameFor(request, pathFilename),
      readBytes: () => readLimitedBody(request, MAX_BODY_BYTES),
    })
    const { asset, session, uploaded } = result
    return Response.json(
      {
        assetId: asset.id,
        filename: asset.originalFilename,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        url: assetUrl(asset),
        uploaded,
        maxFiles: session.maxFiles,
        next: 'Send the next file the same way. After the last one, call get_asset_upload with this upload id and finish: true. That is required: it closes the link and returns every file with a preview.',
      },
      { status: 201, headers: NO_STORE },
    )
  } catch (error) {
    return failure(error)
  }
}

/** GET: what the page shows (state, purpose, limits). */
export async function handleSessionInfo(token: string): Promise<Response> {
  const info = await publicSessionInfo(token)
  if (!info) {
    const error = new UploadSessionError('not_found')
    return errorResponse(error.status, error.code, error.message)
  }
  return Response.json(info, { headers: NO_STORE })
}

/** POST: the page's last step. Closes the link at once. */
export async function handleSessionFinish(token: string): Promise<Response> {
  try {
    const session = await finishSessionByToken(token)
    return Response.json(
      { state: sessionState(session) },
      { headers: NO_STORE },
    )
  } catch (error) {
    return failure(error)
  }
}
