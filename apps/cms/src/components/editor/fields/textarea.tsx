import { Textarea } from '#/components/ui/textarea'
import { cn } from '#/lib/utils'

export function TextareaFieldInput({
  id,
  value,
  onChange,
  placeholder,
  borderless = false,
}: {
  id: string
  value: unknown
  onChange: (value: string) => void
  placeholder?: string
  /** Canvas variant: no box, body-md text, grows with the content. */
  borderless?: boolean
}) {
  return (
    <Textarea
      id={id}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cn(
        borderless &&
          'min-h-16 resize-none rounded-none border-0 bg-transparent px-0 text-ds-body-md shadow-none hover:bg-transparent focus-visible:border-0 focus-visible:outline-none',
      )}
    />
  )
}
