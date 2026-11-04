/** Client-side checks for the upload page. The server checks every file again. */

export const UPLOAD_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,application/pdf'

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
}

export type RejectReason = 'svg' | 'heic' | 'type' | 'size' | 'count' | 'empty'

export type Rejected = { name: string; reason: RejectReason }

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** The media type the file will be treated as, or null. Some browsers leave `type` empty. */
export function fileKind(
  file: Pick<File, 'name' | 'type'>,
): 'image' | 'pdf' | null {
  const type =
    file.type.toLowerCase() || TYPE_BY_EXTENSION[extensionOf(file.name)] || ''
  if (IMAGE_TYPES.has(type)) return 'image'
  if (type === 'application/pdf') return 'pdf'
  return null
}

/** Why a file cannot be added, or null when it can. */
export function rejectReason(
  file: Pick<File, 'name' | 'type' | 'size'>,
  maxBytes: number,
): RejectReason | null {
  const type = file.type.toLowerCase()
  const ext = extensionOf(file.name)
  if (type === 'image/svg+xml' || ext === 'svg') return 'svg'
  if (
    type === 'image/heic' ||
    type === 'image/heif' ||
    ext === 'heic' ||
    ext === 'heif'
  ) {
    return 'heic'
  }
  if (!fileKind(file)) return 'type'
  if (file.size === 0) return 'empty'
  if (file.size > maxBytes) return 'size'
  return null
}

/**
 * Splits newly picked files into the ones to add and the ones to refuse, given
 * how many more the link can take.
 */
export function sortIncoming<T extends Pick<File, 'name' | 'type' | 'size'>>(
  files: readonly T[],
  room: number,
  maxBytes: number,
): { accepted: T[]; rejected: Rejected[] } {
  const accepted: T[] = []
  const rejected: Rejected[] = []
  for (const file of files) {
    const reason = rejectReason(file, maxBytes)
    if (reason) {
      rejected.push({ name: file.name, reason })
    } else if (accepted.length >= room) {
      rejected.push({ name: file.name, reason: 'count' })
    } else {
      accepted.push(file)
    }
  }
  return { accepted, rejected }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Pasted images often arrive as "image.png"; give each a distinct, dated name. */
export function namePasted(file: File, index: number, now = new Date()): File {
  if (file.name && file.name !== 'image.png' && file.name !== 'image.jpg') {
    return file
  }
  const ext = extensionOf(file.name) || 'png'
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return new File([file], `pasted-${stamp}-${index + 1}.${ext}`, {
    type: file.type,
  })
}
