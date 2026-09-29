import { createCn } from 'cn/config'

/**
 * The type-scale utilities (`text-display`, `text-caption`, …) set a font
 * size, not a colour. Without this the merger reads them as text colours and
 * drops them whenever a class list also sets `text-text-primary`.
 */
const TYPE_SCALE = [
  'display',
  'title-1',
  'title-2',
  'headline',
  'body',
  'body-lg',
  'callout',
  'caption',
  'overline',
  'mono',
  'editor-title',
  // LEGACY: remove in phase 3
  'ds-heading-1',
  'ds-heading-2',
  'ds-heading-3',
  'ds-heading-4',
  'ds-heading-5',
  'ds-heading-6',
  'ds-body-lg',
  'ds-body-md',
  'ds-body-sm',
  'ds-body-xs',
  'ds-label-md',
  'ds-label-sm',
  'ds-mono-sm',
  'ds-mono-xs',
  'ds-mono-caps',
]

export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [{ text: TYPE_SCALE }],
      shadow: [{ shadow: ['card', 'float', 'raise'] }],
      rounded: [{ rounded: ['control', 'card', 'panel', 'thumb', 'pill', 'surface'] }],
    },
  },
})

/** Initials for avatars and tiles: "Kaan Kaya" → "KK". */
export function initials(name: string | null | undefined, fallback = '?') {
  if (!name) return fallback
  return (
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || fallback
  )
}
