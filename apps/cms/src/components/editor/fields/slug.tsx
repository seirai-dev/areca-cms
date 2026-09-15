import { Input } from '#/components/ui/input'

export const SLUG_HINT =
  'Lowercase letters, numbers, and hyphens only (e.g. hello-world). Filled from the title until you edit it.'

export function SlugFieldInput({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string
  value: unknown
  onChange: (value: string) => void
  invalid?: boolean
}) {
  return (
    <Input
      id={id}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={invalid || undefined}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      className="font-mono text-sm"
    />
  )
}
