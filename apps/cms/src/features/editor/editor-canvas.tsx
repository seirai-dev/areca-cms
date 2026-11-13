import * as React from 'react'

import { fieldAria, joinDescribedBy } from '#/components/ui/field-aria'
import type { FieldErrorMap } from '#/lib/content/utils'
import { isTranslatable } from '#/lib/content-locale'
import { uiLanguageName } from '#/lib/site-languages'
import type { EntryData, Field } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { MainReference } from './main-reference'
import { SharedMarker, translateProps, useLocaleFields } from './locale-fields'
import type { LocaleFields } from './locale-fields'
import type { LinkContext } from './rich-text/link-picker'
import { RichTextEditor } from './rich-text/rich-text-editor'
import { RichTextPreview } from './rich-text/rich-text-preview'

/** Main-language reference under a translatable field, when not on main. */
function referenceFor(
  locale: LocaleFields | null,
  field: Field,
  onCopy: (value: unknown) => void,
) {
  if (!locale || locale.isMain || !isTranslatable(field)) return null
  return (
    <MainReference
      fieldKey={field.key}
      type={field.type}
      value={locale.mainView[field.key]}
      mainCode={locale.main.toUpperCase()}
      mainName={locale.mainName}
      onCopy={onCopy}
      {...translateProps(locale, field)}
    />
  )
}

/** "Same in all languages" for a shared canvas field, when not on main. */
function sharedFor(locale: LocaleFields | null, field: Field) {
  return locale && !locale.isMain && !isTranslatable(field) ? (
    <SharedMarker />
  ) : null
}

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
  linkContext,
  previewing,
  titleRef,
  transitionName,
  compact = false,
}: {
  titleField?: Field
  canvasFields: Field[]
  data: EntryData
  errors: FieldErrorMap
  onChange: (key: string, value: unknown) => void
  organizationId: string
  /** Whose entry links the rich text fields offer and check. */
  linkContext: LinkContext
  previewing: boolean
  titleRef: React.RefObject<HTMLTextAreaElement | null>
  transitionName?: string
  /** Visual mode's narrow column: no Write-mode minimum height on the body. */
  compact?: boolean
}) {
  const firstBodyRef = React.useRef<HTMLElement | null>(null)
  const locale = useLocaleFields()
  // One change handler per rich text field that never changes, so the fields
  // not being typed in skip their render (RichTextEditor is memoised).
  const onChangeRef = React.useRef(onChange)
  onChangeRef.current = onChange
  const [handlers] = React.useState(
    () => new Map<string, (value: unknown) => void>(),
  )
  const handlerFor = (key: string) => {
    let handler = handlers.get(key)
    if (!handler) {
      handler = (value) => onChangeRef.current(key, value)
      handlers.set(key, handler)
    }
    return handler
  }
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
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2"
          data-field={titleField.key}
          data-invalid={errors[titleField.key] ? 'true' : undefined}
        >
          <label htmlFor={`field-${titleField.key}`} className="sr-only">
            {titleField.label}
          </label>
          {referenceFor(locale, titleField, (value) =>
            onChange(titleField.key, value),
          )}
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
            placeholder={
              locale && !locale.isMain
                ? m.editor_title_in_language({
                    language: uiLanguageName(locale.active),
                  })
                : m.editor_untitled()
            }
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
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2"
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
            {/* Only the untitled body reads reference-first; a labelled textarea
                puts the reference under its label (see CanvasTextarea). */}
            {field.type === 'richtext'
              ? referenceFor(locale, field, (value) =>
                  onChange(field.key, value),
                )
              : null}
            {field.type === 'richtext' ? (
              <div className="grid min-w-0 gap-1">
                <label htmlFor={`field-${field.key}`} className="sr-only">
                  {field.label}
                </label>
                {sharedFor(locale, field)}
                <RichTextEditor
                  id={`field-${field.key}`}
                  label={field.label}
                  value={data[field.key]}
                  onChange={handlerFor(field.key)}
                  organizationId={organizationId}
                  linkContext={linkContext}
                  invalid={Boolean(errors[field.key])}
                  previewing={previewing}
                  compact={compact}
                  preview={
                    previewing ? (
                      <RichTextPreview value={data[field.key]} />
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <CanvasTextarea
                field={field}
                value={data[field.key]}
                onChange={(value) => onChange(field.key, value)}
                invalid={Boolean(errors[field.key])}
                describedBy={describedBy}
                innerRef={index === 0 ? firstBodyRef : undefined}
                shared={sharedFor(locale, field)}
                reference={referenceFor(locale, field, (value) =>
                  onChange(field.key, value),
                )}
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
  shared,
  reference,
}: {
  field: Field
  value: unknown
  onChange: (value: string) => void
  invalid: boolean
  describedBy?: string
  innerRef?: React.RefObject<HTMLElement | null>
  shared?: React.ReactNode
  reference?: React.ReactNode
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const text = typeof value === 'string' ? value : ''
  useAutoGrow(ref, text)
  return (
    <div className="grid min-w-0 gap-1">
      <label
        htmlFor={`field-${field.key}`}
        className="text-overline text-text-muted"
      >
        {field.label}
        {field.required ? <span aria-hidden="true"> *</span> : null}
        {shared ? (
          <span className="ml-2 inline-flex align-middle">{shared}</span>
        ) : null}
      </label>
      {reference ? <div className="mb-1">{reference}</div> : null}
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
    </div>
  )
}
