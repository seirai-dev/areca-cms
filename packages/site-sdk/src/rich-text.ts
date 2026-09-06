import type { RichTextValue } from './types.js'

export function richTextHtml(value: RichTextValue | null | undefined): string {
  return value?.html ?? ''
}
