import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Sparkle, WarningCircle } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Spinner } from '#/components/ui/spinner'
import type { AiSeoSuggestion } from '#/lib/ai-seo'
import { errorMessage } from '#/lib/content/utils'
import { queryKeys } from '#/lib/content/query-keys'
import type { EntrySeo } from '#/lib/seo'
import type { EntryData } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { generateEntrySeoFn } from '#/server/fn/ai'
import { updateAssetFn } from '#/server/fn/assets'

import { compactSeo } from './seo-panel'

type SuggestionKey = Exclude<keyof AiSeoSuggestion, 'imageAlts'>

const KEYS: SuggestionKey[] = [
  'title',
  'description',
  'focusKeyphrase',
  'ogTitle',
  'ogDescription',
  'summary',
  'keyTakeaways',
  'faq',
  'schemaType',
  'about',
]

function labelOf(key: SuggestionKey) {
  switch (key) {
    case 'title':
      return m.editor_seo_title()
    case 'description':
      return m.editor_seo_description()
    case 'focusKeyphrase':
      return m.editor_seo_keyphrase()
    case 'ogTitle':
      return m.editor_seo_og_title()
    case 'ogDescription':
      return m.editor_seo_og_description()
    case 'summary':
      return m.editor_seo_summary()
    case 'keyTakeaways':
      return m.editor_seo_takeaways()
    case 'faq':
      return m.editor_seo_faq()
    case 'schemaType':
      return m.editor_seo_schema_type()
    case 'about':
      return m.editor_seo_about()
  }
}

/** Stored-shape value for a suggestion key (`undefined` = nothing to apply). */
function suggestedValue(s: AiSeoSuggestion, key: SuggestionKey): unknown {
  const value = s[key]
  if (Array.isArray(value)) return value.length ? value : undefined
  return typeof value === 'string' && value.trim() ? value : undefined
}

function render(key: SuggestionKey, value: unknown): React.ReactNode {
  if (value == null || value === '') return null
  if (key === 'keyTakeaways')
    return (
      <ul className="grid list-disc gap-0.5 pl-4">
        {(value as string[]).map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    )
  if (key === 'faq')
    return (
      <dl className="grid gap-1.5">
        {(value as { question: string; answer: string }[]).map((item, i) => (
          <div key={i}>
            <dt className="font-medium text-text-primary">{item.question}</dt>
            <dd>{item.answer}</dd>
          </div>
        ))}
      </dl>
    )
  if (key === 'about')
    return (
      <span>
        {(value as { name: string; sameAs?: string }[])
          .map((item) => item.name)
          .join(', ')}
      </span>
    )
  return <span className="whitespace-pre-wrap">{String(value)}</span>
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * "Generate with AI": sends the current (possibly unsaved) entry to the
 * configured model, then lets the editor pick which suggestions to apply.
 * Nothing is written until "Apply"; applying edits the draft like typing.
 */
export function AiSeoDialog({
  open,
  onOpenChange,
  siteId,
  collectionKey,
  entryId,
  locale,
  data,
  seo,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  siteId: string
  collectionKey: string
  entryId: string | undefined
  /** The language being edited (multilingual sites). Alt text is per language. */
  locale?: string | null
  data: EntryData
  seo: EntrySeo
  onApply: (next: EntrySeo | undefined) => void
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const generate = useMutation({
    mutationFn: () =>
      generateEntrySeoFn({
        data: {
          siteId,
          collectionKey,
          entryId,
          data,
          locale: locale ?? undefined,
        },
      }),
    onSuccess: (result) => {
      const next = new Set<string>()
      for (const key of KEYS) {
        const value = suggestedValue(result.suggestion, key)
        if (value !== undefined && !same(value, seo[key])) next.add(key)
      }
      for (const alt of result.suggestion.imageAlts)
        next.add(`alt:${alt.imageId}`)
      setSelected(next)
    },
  })
  const apply = useMutation({
    mutationFn: async () => {
      const result = generate.data
      if (!result) return
      const next: Record<string, unknown> = { ...seo }
      for (const key of KEYS) {
        if (!selected.has(key)) continue
        next[key] = suggestedValue(result.suggestion, key)
      }
      onApply(compactSeo(next))
      const alts = result.suggestion.imageAlts.filter((alt) =>
        selected.has(`alt:${alt.imageId}`),
      )
      await Promise.all(
        alts.map((alt) =>
          updateAssetFn({
            data: {
              id: alt.imageId,
              altText: alt.alt,
              siteId,
              locale: locale ?? undefined,
            },
          }),
        ),
      )
      for (const alt of alts)
        void queryClient.invalidateQueries({
          queryKey: queryKeys.asset(alt.imageId),
        })
    },
    onSuccess: () => {
      toast.success(m.editor_ai_applied())
      onOpenChange(false)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  // A fresh run each time the dialog opens.
  const { mutate, reset } = generate
  React.useEffect(() => {
    if (open) mutate()
    else reset()
  }, [open, mutate, reset])

  const result = generate.data
  const rows = result
    ? KEYS.map((key) => ({
        key,
        current: seo[key],
        next: suggestedValue(result.suggestion, key),
      })).filter(
        (row) => row.next !== undefined && !same(row.next, row.current),
      )
    : []
  const images = new Map(result?.images.map((image) => [image.id, image]))
  const toggle = (key: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  const allKeys = [
    ...rows.map((row) => row.key as string),
    ...(result?.suggestion.imageAlts.map((alt) => `alt:${alt.imageId}`) ?? []),
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="ai-seo-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkle weight="fill" className="size-4 text-text-accent" />
            {m.editor_ai_title()}
          </DialogTitle>
          <DialogDescription>{m.editor_ai_description()}</DialogDescription>
        </DialogHeader>

        {generate.isPending ? (
          <div
            className="grid place-items-center gap-3 py-12 text-callout text-text-secondary"
            data-testid="ai-seo-loading"
          >
            <Spinner size={20} />
            {m.editor_ai_loading()}
          </div>
        ) : generate.isError ? (
          <div className="grid gap-3 py-6" role="alert">
            <p className="flex items-start gap-2 text-callout text-text-error">
              <WarningCircle className="mt-0.5 size-4 shrink-0" />
              {errorMessage(generate.error)}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-fit"
              onClick={() => generate.mutate()}
            >
              {m.editor_ai_retry()}
            </Button>
          </div>
        ) : result ? (
          <div className="grid gap-4">
            {result.warnings.length ? (
              <div role="status" className="text-callout text-text-muted">
                {result.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
            {allKeys.length === 0 ? (
              <p className="py-6 text-center text-callout text-text-muted">
                {m.editor_ai_nothing_new()}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-caption font-normal text-text-muted">
                    {m.editor_ai_model_line({
                      model: result.model,
                      images: result.usedImages
                        ? m.editor_ai_with_images()
                        : m.editor_ai_text_only(),
                    })}
                  </span>
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    onClick={() =>
                      setSelected(
                        selected.size === allKeys.length
                          ? new Set()
                          : new Set(allKeys),
                      )
                    }
                  >
                    {selected.size === allKeys.length
                      ? m.editor_ai_select_none()
                      : m.editor_ai_select_all()}
                  </Button>
                </div>
                <ul className="grid max-h-[55dvh] gap-2 overflow-y-auto pr-1">
                  {rows.map((row) => (
                    <li key={row.key}>
                      <label
                        className={cn(
                          'grid cursor-pointer grid-cols-[18px_minmax(0,1fr)] gap-3 rounded-[10px] border p-3 transition-colors',
                          selected.has(row.key)
                            ? 'border-accent bg-accent-soft/40'
                            : 'border-border-default',
                        )}
                        data-testid={`ai-row-${row.key}`}
                      >
                        <Checkbox
                          checked={selected.has(row.key)}
                          onCheckedChange={(on) => toggle(row.key, on === true)}
                          className="mt-0.5"
                        />
                        <span className="grid min-w-0 gap-1.5 text-callout text-text-secondary">
                          <span className="text-[13px] font-medium text-text-primary">
                            {labelOf(row.key)}
                          </span>
                          {render(row.key, row.current) ? (
                            <span className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 text-text-muted line-through decoration-text-muted/40">
                              <span className="no-underline">
                                {m.editor_ai_current()}
                              </span>
                              <span>{render(row.key, row.current)}</span>
                            </span>
                          ) : null}
                          <span className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 text-text-primary">
                            <ArrowRight className="mt-1 size-3 text-text-accent" />
                            {render(row.key, row.next)}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                  {result.suggestion.imageAlts.map((alt) => {
                    const image = images.get(alt.imageId)
                    const key = `alt:${alt.imageId}`
                    return (
                      <li key={key}>
                        <label
                          className={cn(
                            'grid cursor-pointer grid-cols-[18px_56px_minmax(0,1fr)] items-start gap-3 rounded-[10px] border p-3 transition-colors',
                            selected.has(key)
                              ? 'border-accent bg-accent-soft/40'
                              : 'border-border-default',
                          )}
                          data-testid={`ai-row-alt-${alt.imageId}`}
                        >
                          <Checkbox
                            checked={selected.has(key)}
                            onCheckedChange={(on) => toggle(key, on === true)}
                            className="mt-0.5"
                          />
                          {image ? (
                            <img
                              src={image.url}
                              alt=""
                              className="aspect-square w-14 rounded-[8px] object-cover"
                            />
                          ) : (
                            <span />
                          )}
                          <span className="grid min-w-0 gap-1 text-callout">
                            <span className="text-[13px] font-medium text-text-primary">
                              {m.editor_ai_alt_for({
                                file: image?.filename ?? alt.imageId,
                              })}
                            </span>
                            <span className="text-text-primary">{alt.alt}</span>
                            <span className="text-caption font-normal text-text-muted">
                              {m.editor_ai_alt_note()}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
              >
                {m.editor_cancel()}
              </Button>
              <Button
                type="button"
                variant="accent"
                disabled={selected.size === 0}
                loading={apply.isPending}
                onClick={() => apply.mutate()}
                data-testid="ai-seo-apply"
              >
                {m.editor_ai_apply({ count: selected.size })}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
