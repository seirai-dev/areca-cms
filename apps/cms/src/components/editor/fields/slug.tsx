import { Input } from '#/components/ui/input'

export function SlugFieldInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: unknown
  onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-1">
      <Input
        id={id}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Lowercase letters, numbers, and hyphens only (e.g. hello-world).
        Filled from the title until you edit it.
      </p>
    </div>
  )
}
