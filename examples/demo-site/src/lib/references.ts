/**
 * Target id of a reference field, or undefined when the field is empty
 * (null, missing, or the CMS's ''). Pure, so client components can import it
 * without pulling the Node-only content reader into the browser bundle.
 */
export function referenceId(ref: { id: string } | '' | null | undefined): string | undefined {
  return ref ? ref.id : undefined
}
