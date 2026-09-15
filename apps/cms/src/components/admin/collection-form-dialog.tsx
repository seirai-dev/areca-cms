import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { FormField } from '#/components/form-field'
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

import { FIELD_TYPES } from './helpers'

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
  const [fields, setFields] = useState<FieldDraft[]>([emptyField()])
  const editing = Boolean(initial)

  useEffect(() => {
    if (!open) {
      return
    }
    setKey(initial?.key ?? '')
    setLabel(initial?.label ?? '')
    setRoutePattern(initial?.routePattern ?? '')
    setEnabled(initial?.enabled ?? true)
    setFields(
      initial?.fields.length
        ? initial.fields.map((field) => ({
            key: field.key,
            label: field.label,
            type: field.type,
            required: Boolean(field.required),
            options: field.options?.join(', ') ?? '',
            collection: field.collection ?? '',
          }))
        : [emptyField()],
    )
  }, [open, initial])

  function updateField(index: number, patch: Partial<FieldDraft>) {
    setFields((current) =>
      current.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    )
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit({
      key,
      label,
      routePattern,
      enabled,
      fields: fields
        .filter((field) => field.key.trim() && field.label.trim())
        .map((field) => ({
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Edit collection' : 'Add collection'}
            </DialogTitle>
            <DialogDescription>
              Collection schemas are agency-owned and used by the site manifest.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Key" htmlFor="collection-key">
            <Input
              id="collection-key"
              data-testid="collection-key"
              required
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </FormField>
          <FormField label="Label" htmlFor="collection-label">
            <Input
              id="collection-label"
              data-testid="collection-label"
              required
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </FormField>
          <FormField label="Route pattern" htmlFor="collection-route">
            <Input
              id="collection-route"
              data-testid="collection-route"
              required
              placeholder="/pages/$slug"
              value={routePattern}
              onChange={(event) => setRoutePattern(event.target.value)}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={enabled}
              onCheckedChange={(value) => setEnabled(value === true)}
            />
            Enabled
          </label>
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Fields</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="add-field"
                onClick={() =>
                  setFields((current) => [...current, emptyField()])
                }
              >
                Add field
              </Button>
            </div>
            {fields.map((field, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-md border p-3"
                data-testid={`field-row-${index}`}
              >
                <div className="grid gap-2 sm:grid-cols-3">
                  <FormField label="Key" htmlFor={`field-key-${index}`}>
                    <Input
                      id={`field-key-${index}`}
                      data-testid={`field-key-${index}`}
                      value={field.key}
                      onChange={(event) =>
                        updateField(index, { key: event.target.value })
                      }
                    />
                  </FormField>
                  <FormField label="Label" htmlFor={`field-label-${index}`}>
                    <Input
                      id={`field-label-${index}`}
                      data-testid={`field-label-${index}`}
                      value={field.label}
                      onChange={(event) =>
                        updateField(index, { label: event.target.value })
                      }
                    />
                  </FormField>
                  <FormField label="Type" htmlFor={`field-type-${index}`}>
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
                            {type}
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
                  Required
                </label>
                {field.type === 'select' ? (
                  <FormField label="Options" htmlFor={`field-options-${index}`}>
                    <Input
                      id={`field-options-${index}`}
                      placeholder="draft, published"
                      value={field.options}
                      onChange={(event) =>
                        updateField(index, { options: event.target.value })
                      }
                    />
                  </FormField>
                ) : null}
                {field.type === 'reference' ? (
                  <FormField
                    label="Collection"
                    htmlFor={`field-collection-${index}`}
                  >
                    <Input
                      id={`field-collection-${index}`}
                      value={field.collection}
                      onChange={(event) =>
                        updateField(index, { collection: event.target.value })
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
                      ? 'A collection needs at least one field'
                      : undefined
                  }
                  onClick={() =>
                    setFields((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove field
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              data-testid="save-collection"
              disabled={pending}
            >
              {pending ? 'Saving…' : 'Save collection'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
