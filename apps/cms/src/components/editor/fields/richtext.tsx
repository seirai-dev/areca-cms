import { RichTextEditor } from '../rich-text-editor'

export function RichtextFieldInput({
  value,
  onChange,
  organizationId,
}: {
  value: unknown
  onChange: (value: unknown) => void
  organizationId: string
}) {
  return (
    <RichTextEditor
      value={value}
      onChange={onChange}
      organizationId={organizationId}
    />
  )
}
