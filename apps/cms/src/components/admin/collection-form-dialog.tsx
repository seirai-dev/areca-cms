import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Lock } from 'lucide-react'

import { FormField } from '#/components/form-field'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { Field, FieldType } from '#/lib/types'
import {
  REQUIRED_SLUG_FIELD,
  withRequiredSlugField,
} from '#/lib/collection-fields'
import { m } from '#/paraglide/messages'

import { FIELD_TYPES, fieldTypeLabel } from './helpers'

type FieldDraft = {
  key: string
  label: string
  type: FieldType
  required: boolean
  options: string
  collection: string
}

const emptyField = (): FieldDraft => ({
  key: '',
  label: '',
  type: 'text',
  required: false,
  options: '',
  collection: '',
})

function toFieldDraft(field: Field): FieldDraft {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    required: Boolean(field.required),
    options: field.options?.join(', ') ?? '',
    collection: field.collection ?? '',
  }
}

const requiredSlugDraft = () => toFieldDraft(REQUIRED_SLUG_FIELD)

export type CollectionDraft = {
  key: string
  label: string
  routePattern: string
  enabled: boolean
  fields: Field[]
}

export function CollectionFormDialog({
  open,
  onOpenChange,
  initial,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: CollectionDraft | null
  pending?: boolean
  onSubmit: (draft: CollectionDraft) => void
}) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [routePattern, setRoutePattern] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [fields, setFields] = useState<FieldDraft[]>([requiredSlugDraft()])
  const [labelError, setLabelError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<number, { key?: string; label?: string }>>
  >({})
  const [dirty, setDirty] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const editing = Boolean(initial)

  useEffect(() => {
    if (!open) {
      return
    }
    setKey(initial?.key ?? '')
    setLabel(initial?.label ?? '')
    setRoutePattern(initial?.routePattern ?? '')
    setEnabled(initial?.enabled ?? true)
    setFields(withRequiredSlugField(initial?.fields ?? []).map(toFieldDraft))
    setLabelError(null)
    setFieldErrors({})
    setDirty(false)
    setDiscardOpen(false)
  }, [open, initial])

  function updateField(index: number, patch: Partial<FieldDraft>) {
    if (index === 0) return
    setDirty(true)
    setFieldErrors((current) => ({ ...current, [index]: {} }))
    setFields((current) =>
      current.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    )
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedLabel = label.trim()
    const nextFieldErrors: Partial<
      Record<number, { key?: string; label?: string }>
    > = {}
    fields.forEach((field, index) => {
      if (!field.key.trim()) {
        nextFieldErrors[index] = {
          ...nextFieldErrors[index],
          key: m.admin_collection_field_key_required(),
        }
      }
      if (!field.label.trim()) {
        nextFieldErrors[index] = {
          ...nextFieldErrors[index],
          label: m.admin_collection_field_label_required(),
        }
      }
    })
    setLabelError(trimmedLabel ? null : m.admin_collection_label_required())
    setFieldErrors(nextFieldErrors)
    if (!trimmedLabel || Object.keys(nextFieldErrors).length > 0) return

    onSubmit({
      key: key.trim(),
      label: trimmedLabel,
      routePattern: routePattern.trim(),
      enabled,
      fields: fields.map((field) => ({
        key: field.key.trim(),
        label: field.label.trim(),
        type: field.type,
        required: field.required || undefined,
        options:
          field.type === 'select'
            ? field.options
                .split(',')
                .map((option) => option.trim())
                .filter(Boolean)
            : undefined,
        collection:
          field.type === 'reference'
            ? field.collection.trim() || undefined
            : undefined,
      })),
    })
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true)
      return
    }
    if (pending) return
    if (dirty || !label.trim()) {
      setDiscardOpen(true)
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {editing
                ? m.admin_collection_edit_title()
                : m.admin_collection_add_title()}
            </DialogTitle>
            <DialogDescription>
              {m.admin_collection_description()}
            </DialogDescription>
          </DialogHeader>
          <FormField label={m.admin_collection_key()} htmlFor="collection-key">
            <Input
              id="collection-key"
              data-testid="collection-key"
              required
              value={key}
              onChange={(event) => {
                setKey(event.target.value)
                setDirty(true)
              }}
            />
          </FormField>
          <FormField
            label={m.admin_collection_label()}
            htmlFor="collection-label"
            error={labelError ?? undefined}
            required
          >
            <Input
              id="collection-label"
              data-testid="collection-label"
              required
              value={label}
              aria-invalid={labelError ? true : undefined}
              onInvalid={() =>
                setLabelError(m.admin_collection_label_required())
              }
              onChange={(event) => {
                setLabel(event.target.value)
                setLabelError(null)
                setDirty(true)
              }}
            />
          </FormField>
          <FormField
            label={m.admin_collection_route()}
            htmlFor="collection-route"
          >
            <Input
              id="collection-route"
              data-testid="collection-route"
              required
              placeholder="/pages/$slug"
              value={routePattern}
              onChange={(event) => {
                setRoutePattern(event.target.value)
                setDirty(true)
              }}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={enabled}
              onCheckedChange={(value) => {
                setEnabled(value === true)
                setDirty(true)
              }}
            />
            {m.admin_collection_enabled()}
          </label>
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {m.admin_collection_fields()}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="add-field"
                onClick={() => {
                  setFields((current) => [...current, emptyField()])
                  setDirty(true)
                }}
              >
                {m.admin_collection_add_field()}
              </Button>
            </div>
            {fields.map((field, index) => {
              const isSlug = index === 0
              if (isSlug) {
                return (
                  <div
                    key={index}
                    className="flex gap-3 rounded-md border bg-muted/40 p-3"
                    data-testid={`field-row-${index}`}
                    data-locked="true"
                  >
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
                      <Lock className="size-4" aria-hidden="true" />
                    </div>
                    <div className="grid min-w-0 flex-1 gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className="text-sm font-medium"
                          data-testid={`field-label-${index}`}
                        >
                          {field.label}
                        </p>
                        <Badge variant="outline">
                          {m.admin_collection_required()}
                        </Badge>
                        <Badge
                          variant="muted"
                          data-testid={`field-type-${index}`}
                        >
                          {fieldTypeLabel(field.type)}
                        </Badge>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {m.admin_collection_slug_field_hint()}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {m.admin_collection_key()}{' '}
                        <span data-testid={`field-key-${index}`}>
                          {field.key}
                        </span>
                      </p>
                    </div>
                  </div>
                )
              }
              return (
                <div
                  key={index}
                  className="grid gap-2 rounded-md border p-3"
                  data-testid={`field-row-${index}`}
                >
                  <div className="grid items-start gap-2 sm:grid-cols-3">
                    <FormField
                      label={m.admin_collection_key()}
                      htmlFor={`field-key-${index}`}
                      error={fieldErrors[index]?.key}
                      required
                    >
                      <Input
                        id={`field-key-${index}`}
                        data-testid={`field-key-${index}`}
                        value={field.key}
                        required
                        aria-invalid={
                          fieldErrors[index]?.key ? true : undefined
                        }
                        onInvalid={() =>
                          setFieldErrors((current) => ({
                            ...current,
                            [index]: {
                              ...current[index],
                              key: m.admin_collection_field_key_required(),
                            },
                          }))
                        }
                        onChange={(event) =>
                          updateField(index, { key: event.target.value })
                        }
                      />
                    </FormField>
                    <FormField
                      label={m.admin_collection_label()}
                      htmlFor={`field-label-${index}`}
                      error={fieldErrors[index]?.label}
                      required
                    >
                      <Input
                        id={`field-label-${index}`}
                        data-testid={`field-label-${index}`}
                        value={field.label}
                        required
                        aria-invalid={
                          fieldErrors[index]?.label ? true : undefined
                        }
                        onInvalid={() =>
                          setFieldErrors((current) => ({
                            ...current,
                            [index]: {
                              ...current[index],
                              label: m.admin_collection_field_label_required(),
                            },
                          }))
                        }
                        onChange={(event) =>
                          updateField(index, { label: event.target.value })
                        }
                      />
                    </FormField>
                    <FormField
                      label={m.admin_collection_field_type()}
                      htmlFor={`field-type-${index}`}
                    >
                      <Select
                        value={field.type}
                        onValueChange={(value) =>
                          updateField(index, { type: value as FieldType })
                        }
                      >
                        <SelectTrigger
                          id={`field-type-${index}`}
                          data-testid={`field-type-${index}`}
                          className="w-full"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {fieldTypeLabel(type)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.required}
                      onCheckedChange={(value) =>
                        updateField(index, { required: value === true })
                      }
                    />
                    {m.admin_collection_required()}
                  </label>
                  {field.type === 'select' ? (
                    <FormField
                      label={m.admin_collection_options()}
                      htmlFor={`field-options-${index}`}
                    >
                      <Input
                        id={`field-options-${index}`}
                        placeholder={m.admin_collection_options_placeholder()}
                        value={field.options}
                        onChange={(event) =>
                          updateField(index, { options: event.target.value })
                        }
                      />
                    </FormField>
                  ) : null}
                  {field.type === 'reference' ? (
                    <FormField
                      label={m.admin_collection_field_collection()}
                      htmlFor={`field-collection-${index}`}
                    >
                      <Input
                        id={`field-collection-${index}`}
                        value={field.collection}
                        onChange={(event) =>
                          updateField(index, {
                            collection: event.target.value,
                          })
                        }
                      />
                    </FormField>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="justify-self-start"
                    disabled={fields.length <= 1}
                    title={
                      fields.length <= 1
                        ? m.admin_collection_min_fields()
                        : undefined
                    }
                    onClick={() => {
                      setFields((current) =>
                        current.filter((_, i) => i !== index),
                      )
                      setDirty(true)
                    }}
                  >
                    {m.admin_collection_remove_field()}
                  </Button>
                </div>
              )
            })}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              data-testid="save-collection"
              disabled={pending}
            >
              {pending ? m.admin_saving() : m.admin_collection_save()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {m.admin_collection_discard_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {m.admin_collection_discard_description()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {m.admin_collection_keep_editing()}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="discard-collection-changes"
              onClick={() => {
                setDirty(false)
                setDiscardOpen(false)
                onOpenChange(false)
              }}
            >
              {m.admin_collection_discard_changes()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
