import { m } from '#/paraglide/messages'

export type MediaAsset = {
  id: string
  storageKey: string
  originalFilename: string
  mimeType: string
  width: number | null
  height: number | null
  altText: string | null
}

/** Upload one file to the client's Library (`/api/assets/upload`). */
export async function uploadAssetFile(
  file: File,
  organizationId: string,
  altText = '',
) {
  const body = new FormData()
  body.append('file', file)
  body.append('organizationId', organizationId)
  body.append('altText', altText)
  const response = await fetch('/api/assets/upload', {
    method: 'POST',
    body,
  })
  if (!response.ok) {
    throw new Error((await response.text()) || m.editor_upload_failed())
  }
  return (await response.json()) as MediaAsset
}

/** File types the Library accepts. */
export const MEDIA_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,application/pdf'
