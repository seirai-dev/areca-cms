import * as React from 'react'

import { fieldAria, joinDescribedBy } from '#/components/ui/field-aria'
import { FormField } from '#/components/ui/form-field'
import { SegmentedControl } from '#/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { Field } from '#/lib/types'
import { m } from '#/paraglide/messages'

/** More choices than this always get the dropdown (DESIGN.md: two to four). */
const MAX_SEGMENTS = 4
/** The segmented track's inner padding and gap (`p-[2px] gap-0.5`). */
const TRACK_PADDING = 2
const TRACK_GAP = 2

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

/**
 * A select field. Short lists render as a segmented control, but only while
 * every label fits its segment at the width the field actually has (the
 * details sidebar is narrow, the canvas is wide). Otherwise the dropdown,
 * so long or many options never clip.
 */
export function SelectFieldControl({
  field,
  id,
  value,
  onChange,
  error,
  trailing,
  reference,
}: {
  field: Field
  id: string
  value: unknown
  onChange: (value: unknown) => void
  error?: string
  /** Right side of the label row (e.g. "Same in all languages"). */
  trailing?: React.ReactNode
  /** Main-language reference, between the label and the choice. */
  reference?: React.ReactNode
}) {
  const options = field.options ?? []
  const current = typeof value === 'string' && value ? value : ''
  const canSegment = options.length > 0 && options.length <= MAX_SEGMENTS
  const segmented = useSegmentsFit(canSegment ? options : [])
  const useSegments = canSegment && segmented.fits

  const clear =
    current && !field.required ? (
      <button
        type="button"
        onClick={() => onChange('')}
        className="w-fit text-caption font-normal text-text-muted hover:text-text-primary hover:underline"
      >
        {m.editor_clear_choice()}
      </button>
    ) : null

  return (
    <div data-field={field.key} className="grid grid-cols-[minmax(0,1fr)]">
      <FormField
        label={field.label}
        htmlFor={useSegments ? undefined : id}
        required={field.required}
        description={field.description}
        error={error}
        trailing={trailing}
        reference={reference}
        className="min-w-0 grid-cols-[minmax(0,1fr)]"
      >
        <div
          ref={segmented.containerRef}
          className="relative grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1"
          role={useSegments ? 'group' : undefined}
        >
          {canSegment ? (
            // Natural label widths, measured offscreen. The clipping box keeps
            // the wide row from adding a horizontal scrollbar to the sidebar.
            <div
              aria-hidden="true"
              className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
            >
              <div ref={segmented.measureRef} className="flex w-max">
                {options.map((option) => (
                  <span
                    key={option}
                    className="px-2.5 text-[12.5px] font-medium whitespace-nowrap"
                  >
                    {option}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {useSegments ? (
            <SegmentedControl
              fullWidth
              size="sm"
              aria-label={field.label}
              value={current}
              onValueChange={(next) => onChange(next)}
              options={options.map((option) => ({
                value: option,
                label: option,
                testId: `${id}-${option}`,
              }))}
              data-testid={id}
            />
          ) : (
            <Select value={current} onValueChange={(next) => onChange(next)}>
              <SelectTrigger
                id={id}
                className="w-full"
                {...fieldAria({
                  invalid: Boolean(error),
                  required: field.required,
                  describedBy: joinDescribedBy(
                    field.description ? `${id}-description` : undefined,
                    error ? `${id}-error` : undefined,
                  ),
                })}
              >
                <SelectValue placeholder={m.editor_select_placeholder()} />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {clear}
        </div>
      </FormField>
    </div>
  )
}

/**
 * Whether every label fits an equal share of the container. Re-checked when
 * the container resizes (sidebar, sheet, window) and when the measured row
 * does (web fonts finishing their load).
 */
function useSegmentsFit(options: string[]) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const measureRef = React.useRef<HTMLDivElement>(null)
  const [fits, setFits] = React.useState(true)
  const count = options.length
  const optionsKey = options.join('\u0000')

  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current
    const measure = measureRef.current
    if (!count || !container || !measure) return

    const check = () => {
      const width = container.clientWidth
      // Hidden (a closed sheet): keep the last answer until it has a size.
      if (width === 0) return
      const slot = (width - TRACK_PADDING * 2 - TRACK_GAP * (count - 1)) / count
      const widest = Math.max(
        ...Array.from(measure.children, (label) =>
          Math.ceil(label.getBoundingClientRect().width),
        ),
      )
      setFits(widest <= slot)
    }

    check()
    const observer = new ResizeObserver(check)
    observer.observe(container)
    observer.observe(measure)
    return () => observer.disconnect()
  }, [count, optionsKey])

  return { containerRef, measureRef, fits }
}
