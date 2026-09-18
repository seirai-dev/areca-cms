import type { MediaAsset } from '#/components/editor/media-picker'

/** A row in the media library: the picker's asset plus the list-only fields. */
export type MediaRow = MediaAsset & {
  size?: number | null
  createdAt?: string | Date
  createdBy?: string | null
  createdByName?: string | null
}
