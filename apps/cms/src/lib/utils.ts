import { createCn } from 'cn/config'

/**
 * The design-system type utilities (`text-ds-heading-4`, `text-ds-mono-xs`, …)
 * set a font size, not a colour. Without this the merger reads them as text
 * colours and drops them whenever a class list also sets `text-text-primary`,
 * which silently flattened every section heading to body text.
 */
const DS_TYPE_SCALE = [
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
  extend: { classGroups: { 'font-size': [{ text: DS_TYPE_SCALE }] } },
})
