import * as React from 'react'

import { fieldAria, joinDescribedBy } from '#/components/ui/field-aria'
import type { FieldErrorMap } from '#/lib/content/utils'
import type { EntryData, Field } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { RichTextEditor } from './rich-text/rich-text-editor'
import { RichTextPreview } from './rich-text/rich-text-preview'

/** Grow a textarea with its content. */
function useAutoGrow(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  React.useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    node.style.height = '0px'
    node.style.height = `${node.scrollHeight}px`
  }, [ref, value])
}

/**
 * The writing surface (brief §3.5): centred at 720px, a borderless 40px
 * title ("Untitled"), then every long-form field as the document body in
 * 17/28 writing type. Nothing here is boxed; whitespace does the work.
 */
export function EditorCanvas({
  titleField,
  canvasFields,
  data,
  errors,
  onChange,
  organizationId,
  previewing,
  titleRef,
  transitionName,
}: {
  titleField?: Field
  canvasFields: Field[]
  data: EntryData
  errors: FieldErrorMap
  onChange: (key: string, value: unknown) => void
  organizationId: string
  previewing: boolean
  titleRef: React.RefObject<HTMLTextAreaElement | null>
  transitionName?: string
}) {
  const firstBodyRef = React.useRef<HTMLElement | null>(null)
  const titleValue =
    titleField && typeof data[titleField.key] === 'string'
      ? (data[titleField.key] as string)
      : ''
  useAutoGrow(titleRef, titleValue)

  return (
    <div
      className="mx-auto grid w-full max-w-[720px] min-w-0 grid-cols-[minmax(0,1fr)] gap-7"
      data-testid="editor-canvas"
    >
      {titleField ? (
        <div
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5"
          data-field={titleField.key}
          data-invalid={errors[titleField.key] ? 'true' : undefined}
        >
          <label htmlFor={`field-${titleField.key}`} className="sr-only">
            {titleField.label}
          </label>
          <textarea
            ref={titleRef}
            id={`field-${titleField.key}`}
            rows={1}
            value={titleValue}
            onChange={(event) =>
              onChange(titleField.key, event.target.value.replace(/\n/g, ' '))
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                const body = document.querySelector<HTMLElement>(
                  '[data-canvas-body] [contenteditable="true"], [data-canvas-body] textarea',
                )
                body?.focus()
              }
            }}
            {...fieldAria({
              invalid: Boolean(errors[titleField.key]),
              required: titleField.required,
              describedBy: errors[titleField.key]
                ? `field-${titleField.key}-error`
                : undefined,
            })}
            placeholder={m.editor_untitled()}
            className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-editor-title text-balance text-text-primary outline-none placeholder:text-text-disabled"
            style={
              transitionName
                ? { viewTransitionName: transitionName }
                : undefined
            }
          />
          {errors[titleField.key] ? (
            <p
              id={`field-${titleField.key}-error`}
              className="text-callout text-text-error"
              role="alert"
            >
              {errors[titleField.key]}
            </p>
          ) : null}
        </div>
      ) : null}

      {canvasFields.map((field, index) => {
        const errorId = `field-${field.key}-error`
        const descriptionId = `field-${field.key}-description`
        const describedBy = joinDescribedBy(
          field.description ? descriptionId : undefined,
          errors[field.key] ? errorId : undefined,
        )
        return (
          <div
            key={field.key}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1"
            data-field={field.key}
            data-invalid={errors[field.key] ? 'true' : undefined}
            data-canvas-body={index === 0 ? '' : undefined}
            {...(field.type === 'richtext'
              ? {
                  role: 'group' as const,
                  ...fieldAria({
                    invalid: Boolean(errors[field.key]),
                    required: field.required,
                    describedBy,
                  }),
                }
              : {})}
          >
            {field.type === 'richtext' ? (
              <>
                <label htmlFor={`field-${field.key}`} className="sr-only">
                  {field.label}
                </label>
                <RichTextEditor
                  id={`field-${field.key}`}
                  label={field.label}
                  value={data[field.key]}
                  onChange={(value) => onChange(field.key, value)}
                  organizationId={organizationId}
                  invalid={Boolean(errors[field.key])}
                  previewing={previewing}
                  preview={<RichTextPreview value={data[field.key]} />}
                />
              </>
            ) : (
              <CanvasTextarea
                field={field}
                value={data[field.key]}
                onChange={(value) => onChange(field.key, value)}
                invalid={Boolean(errors[field.key])}
                describedBy={describedBy}
                innerRef={index === 0 ? firstBodyRef : undefined}
              />
            )}
            {field.description ? (
              <p
                id={descriptionId}
                className="text-caption font-normal text-text-muted"
              >
                {field.description}
              </p>
            ) : null}
            {errors[field.key] ? (
              <p
                id={errorId}
                className="text-callout text-text-error"
                role="alert"
              >
                {errors[field.key]}
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function CanvasTextarea({
  field,
  value,
  onChange,
  invalid,
  describedBy,
  innerRef,
}: {
  field: Field
  value: unknown
  onChange: (value: string) => void
  invalid: boolean
  describedBy?: string
  innerRef?: React.RefObject<HTMLElement | null>
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const text = typeof value === 'string' ? value : ''
  useAutoGrow(ref, text)
  return (
    <>
      <label
        htmlFor={`field-${field.key}`}
        className="text-overline text-text-muted"
      >
        {field.label}
        {field.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <textarea
        ref={(node) => {
          ref.current = node
          if (innerRef) innerRef.current = node
        }}
        id={`field-${field.key}`}
        rows={1}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        {...fieldAria({
          invalid,
          required: field.required,
          describedBy,
        })}
        placeholder={m.editor_canvas_placeholder({
          label: field.label.toLocaleLowerCase(),
        })}
        className={cn(
          'block min-h-7 w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-body-lg text-text-primary outline-none placeholder:text-text-disabled',
        )}
      />
    </>
  )
}
