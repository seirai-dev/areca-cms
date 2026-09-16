import { Input } from '#/components/ui/input'
import { m } from '#/paraglide/messages'

export function slugHint() {
  return m.editor_slug_hint()
}

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
