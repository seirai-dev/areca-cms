import * as React from 'react'
import { CaretRight, Plus, Sparkle, Trash } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { SegmentedControl } from '#/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Switch } from '#/components/ui/switch'
import { Textarea } from '#/components/ui/textarea'
import { globalPublicUrl } from '#/lib/globals'
import {
  SEO_DESCRIPTION_TARGET,
  SEO_KEY,
  SEO_LIMITS,
  SEO_SCHEMA_TYPES,
  SEO_TITLE_TARGET,
  entryPublicUrl,
  truncateText,
} from '#/lib/seo'
import type { EntrySeo, SeoSchemaType, TwitterCard } from '#/lib/seo'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { ImageWell } from './fields/image-well'
import { useRevealListener } from './reveal-field'

type GroupKey = 'search' | 'social' | 'answers' | 'structured' | 'advanced'

/** Which group holds each stored key (errors open their group). */
const GROUP_OF: Record<keyof EntrySeo, GroupKey> = {
  title: 'search',
  description: 'search',
  focusKeyphrase: 'search',
  ogTitle: 'social',
  ogDescription: 'social',
  ogImage: 'social',
  twitterCard: 'social',
  summary: 'answers',
  keyTakeaways: 'answers',
  faq: 'answers',
  schemaType: 'structured',
  about: 'structured',
  author: 'structured',
  canonicalUrl: 'advanced',
  noindex: 'advanced',
  nofollow: 'advanced',
  jsonLd: 'advanced',
}

const fieldId = (key: string) => `seo-${key}`

/**
 * The address shown in the search preview. An entry needs a slug; a site
 * content section has no slug, so its address is its preview path (or none).
 */
export function previewAddress({
  canonicalUrl,
  global,
  productionUrl,
  routePattern,
  slug,
}: {
  canonicalUrl?: string | null
  global: boolean
  productionUrl: string
  routePattern: string
  slug: string
}): string | null {
  if (canonicalUrl?.trim()) return canonicalUrl
  if (global) return globalPublicUrl(productionUrl, routePattern)
  return slug ? entryPublicUrl(productionUrl, routePattern, slug) : null
}

/** Text of a TipTap document, for the description fallback preview. Code
 *  blocks are skipped, matching the server's fallback description. */
export function plainTextOf(doc: unknown): string {
  const parts: string[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const item = node as { type?: string; text?: unknown; content?: unknown }
    if (item.type === 'codeBlock') return
    if (typeof item.text === 'string') parts.push(item.text)
    if (Array.isArray(item.content)) {
      for (const child of item.content) visit(child)
      if (item.type !== 'doc') parts.push(' ')
    }
  }
  visit(doc)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

const isEmpty = (value: unknown) =>
  value == null ||
  value === '' ||
  value === false ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every(isEmpty))

/** Drop empty keys so an untouched block stays absent from entry data. */
export function compactSeo(seo: EntrySeo): EntrySeo | undefined {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(seo)) {
    if (!isEmpty(value)) out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function Counter({ value, target }: { value: string; target: number }) {
  const length = value.trim().length
  return (
    <span
      className={cn(
        'tabular-nums',
        length > target ? 'text-text-warning' : 'text-text-muted',
      )}
    >
      {length}/{target}
    </span>
  )
}

function Group({
  title,
  summary,
  open,
  onToggle,
  children,
  testId,
}: {
  title: string
  summary?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
  testId: string
}) {
  const bodyId = React.useId()
  return (
    <div className="grid border-t border-border-default pt-3 first:border-t-0 first:pt-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className="group flex min-h-7 items-center gap-2 rounded-[6px] text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        data-testid={`${testId}-toggle`}
      >
        <CaretRight
          className={cn(
            'size-3.5 shrink-0 text-icon-muted transition-transform duration-150 motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        <span className="text-[13px] leading-[18px] font-medium text-text-primary">
          {title}
        </span>
        {summary ? (
          <span className="ml-auto truncate text-caption font-normal text-text-muted">
            {summary}
          </span>
        ) : null}
      </button>
      {open ? (
        <div id={bodyId} className="grid gap-4 pt-3" data-testid={testId}>
          {children}
        </div>
      ) : null}
    </div>
  )
}

/** Google-style result preview with the values that will actually ship. */
function SearchPreview({
  url,
  title,
  description,
  global,
}: {
  url: string | null
  title: string
  description: string | null
  /** A site content section has an address only when it has a preview path. */
  global: boolean
}) {
  return (
    <div
      className="grid gap-0.5 rounded-[10px] border border-border-default bg-background-subtle px-3 py-2.5"
      aria-label={m.editor_seo_preview_label()}
      data-testid="seo-search-preview"
    >
      {url || !global ? (
        <span className="truncate text-caption font-normal text-text-muted">
          {url ?? m.editor_seo_preview_no_url()}
        </span>
      ) : null}
      <span className="line-clamp-2 text-[15px] leading-5 font-medium text-text-accent">
        {truncateText(title, SEO_TITLE_TARGET + 5)}
      </span>
      <span className="line-clamp-2 text-callout text-text-secondary">
        {description
          ? truncateText(description, SEO_DESCRIPTION_TARGET)
          : m.editor_seo_preview_no_description()}
      </span>
    </div>
  )
}

function StringList({
  id,
  items,
  onChange,
  max,
  maxLength,
  placeholder,
  addLabel,
}: {
  id: string
  items: string[]
  onChange: (items: string[]) => void
  max: number
  maxLength: number
  placeholder: string
  addLabel: string
}) {
  return (
    <div className="grid gap-2" id={id}>
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-1.5">
          <Textarea
            value={item}
            maxLength={maxLength}
            rows={1}
            className="min-h-9"
            placeholder={placeholder}
            aria-label={`${placeholder} ${index + 1}`}
            onChange={(event) =>
              onChange(
                items.map((value, i) =>
                  i === index ? event.target.value : value,
                ),
              )
            }
          />
          <Button
            type="button"
            variant="quiet"
            size="icon-sm"
            aria-label={m.editor_seo_remove_item()}
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <Trash />
          </Button>
        </div>
      ))}
      {items.length < max ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="w-fit"
          onClick={() => onChange([...items, ''])}
        >
          <Plus />
          {addLabel}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Built-in SEO & discovery block (stored under `$seo`): search snippet,
 * social card, answer-engine content, structured data and indexing rules.
 * Empty values fall back to the entry (title, excerpt, hero image) when the
 * snapshot resolves `entry.seo`, and the preview shows those fallbacks.
 */
export function SeoPanel({
  seo,
  onChange,
  errors,
  organizationId,
  productionUrl,
  routePattern,
  slug,
  entryTitle,
  fallbackDescription,
  aiEnabled,
  onGenerate,
  global = false,
}: {
  seo: EntrySeo
  onChange: (next: EntrySeo | undefined) => void
  errors: Record<string, string>
  organizationId: string
  productionUrl: string
  /** Entries: the route pattern. Site content sections: the preview path. */
  routePattern: string
  slug: string
  /** The entry title, or the section name for a site content section. */
  entryTitle: string
  fallbackDescription: string | null
  aiEnabled: boolean
  onGenerate: () => void
  /** A site content section: no slug, address is the preview path. */
  global?: boolean
}) {
  const [open, setOpen] = React.useState<Record<GroupKey, boolean>>({
    search: true,
    social: false,
    answers: false,
    structured: false,
    advanced: false,
  })

  // Reveal groups that hold a server error.
  const errorGroups = Object.keys(errors)
    .filter((path) => path.startsWith(`${SEO_KEY}.`))
    .map((path) => GROUP_OF[path.split('.')[1] as keyof EntrySeo])
    .filter(Boolean)
  const errorKey = errorGroups.join(',')
  React.useEffect(() => {
    if (!errorKey) return
    setOpen((prev) => {
      const next = { ...prev }
      for (const group of errorKey.split(',')) next[group as GroupKey] = true
      return next
    })
  }, [errorKey])

  // The visual editor reveals a field: open the group that holds it.
  useRevealListener((key) => {
    if (!key.startsWith(`${SEO_KEY}.`)) return
    const group = GROUP_OF[key.slice(SEO_KEY.length + 1) as keyof EntrySeo] as
      GroupKey | undefined
    if (group)
      setOpen((prev) => (prev[group] ? prev : { ...prev, [group]: true }))
  })

  const set = <TKey extends keyof EntrySeo>(key: TKey, value: EntrySeo[TKey]) =>
    onChange(compactSeo({ ...seo, [key]: value }))
  const err = (key: string) => errors[`${SEO_KEY}.${key}`]
  const errUnder = (key: string) =>
    Object.entries(errors).find(([path]) =>
      path.startsWith(`${SEO_KEY}.${key}.`),
    )?.[1]
  const toggle = (group: GroupKey) =>
    setOpen((prev) => ({ ...prev, [group]: !prev[group] }))
  const filled = (group: GroupKey) => {
    const count = (Object.keys(GROUP_OF) as (keyof EntrySeo)[]).filter(
      (key) => GROUP_OF[key] === group && !isEmpty(seo[key]),
    ).length
    return count > 0 ? m.editor_seo_group_filled({ count }) : undefined
  }

  const url = previewAddress({
    canonicalUrl: seo.canonicalUrl,
    global,
    productionUrl,
    routePattern,
    slug,
  })
  const previewTitle = seo.title?.trim() || entryTitle
  const previewDescription =
    seo.description?.trim() || seo.summary?.trim() || fallbackDescription
  const keyphrase = seo.focusKeyphrase?.trim().toLowerCase()
  const keyphraseHits = keyphrase
    ? [previewTitle, previewDescription ?? ''].filter((text) =>
        text.toLowerCase().includes(keyphrase),
      ).length
    : 0

  const text = (key: keyof EntrySeo) =>
    typeof seo[key] === 'string' ? seo[key] : ''
  const faq = seo.faq ?? []
  const about = seo.about ?? []

  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)] gap-3"
      data-testid="seo-panel"
    >
      {aiEnabled ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onGenerate}
          data-testid="seo-generate"
        >
          <Sparkle weight="fill" className="text-text-accent" />
          {m.editor_seo_generate()}
        </Button>
      ) : null}

      <SearchPreview
        url={url}
        title={previewTitle}
        description={previewDescription}
        global={global}
      />

      <Group
        title={m.editor_seo_group_search()}
        summary={filled('search')}
        open={open.search}
        onToggle={() => toggle('search')}
        testId="seo-group-search"
      >
        <FormField
          label={m.editor_seo_title()}
          htmlFor={fieldId('title')}
          error={err('title')}
          trailing={<Counter value={previewTitle} target={SEO_TITLE_TARGET} />}
          hint={global ? m.globals_seo_title_hint() : m.editor_seo_title_hint()}
        >
          <Input
            id={fieldId('title')}
            data-field={`${SEO_KEY}.title`}
            value={text('title')}
            placeholder={entryTitle}
            maxLength={SEO_LIMITS.title}
            onChange={(event) => set('title', event.target.value)}
          />
        </FormField>
        <FormField
          label={m.editor_seo_description()}
          htmlFor={fieldId('description')}
          error={err('description')}
          trailing={
            <Counter
              value={previewDescription ?? ''}
              target={SEO_DESCRIPTION_TARGET}
            />
          }
          hint={m.editor_seo_description_hint()}
        >
          <Textarea
            id={fieldId('description')}
            data-field={`${SEO_KEY}.description`}
            value={text('description')}
            placeholder={fallbackDescription ?? undefined}
            maxLength={SEO_LIMITS.description}
            onChange={(event) => set('description', event.target.value)}
          />
        </FormField>
        <FormField
          label={m.editor_seo_keyphrase()}
          htmlFor={fieldId('focusKeyphrase')}
          error={err('focusKeyphrase')}
          hint={
            keyphrase
              ? keyphraseHits === 2
                ? m.editor_seo_keyphrase_ok()
                : m.editor_seo_keyphrase_missing()
              : m.editor_seo_keyphrase_hint()
          }
        >
          <Input
            id={fieldId('focusKeyphrase')}
            data-field={`${SEO_KEY}.focusKeyphrase`}
            value={text('focusKeyphrase')}
            maxLength={SEO_LIMITS.keyphrase}
            onChange={(event) => set('focusKeyphrase', event.target.value)}
          />
        </FormField>
      </Group>

      <Group
        title={m.editor_seo_group_social()}
        summary={filled('social')}
        open={open.social}
        onToggle={() => toggle('social')}
        testId="seo-group-social"
      >
        <FormField
          label={m.editor_seo_og_title()}
          htmlFor={fieldId('ogTitle')}
          error={err('ogTitle')}
        >
          <Input
            id={fieldId('ogTitle')}
            data-field={`${SEO_KEY}.ogTitle`}
            value={text('ogTitle')}
            placeholder={previewTitle}
            maxLength={SEO_LIMITS.title}
            onChange={(event) => set('ogTitle', event.target.value)}
          />
        </FormField>
        <FormField
          label={m.editor_seo_og_description()}
          htmlFor={fieldId('ogDescription')}
          error={err('ogDescription')}
        >
          <Textarea
            id={fieldId('ogDescription')}
            data-field={`${SEO_KEY}.ogDescription`}
            value={text('ogDescription')}
            placeholder={previewDescription ?? undefined}
            maxLength={SEO_LIMITS.description}
            onChange={(event) => set('ogDescription', event.target.value)}
          />
        </FormField>
        <FormField
          label={m.editor_seo_og_image()}
          error={err('ogImage')}
          hint={m.editor_seo_og_image_hint()}
        >
          <div role="group" data-field={`${SEO_KEY}.ogImage`}>
            <ImageWell
              id={fieldId('ogImage')}
              organizationId={organizationId}
              value={seo.ogImage ?? ''}
              onChange={(value) => set('ogImage', value)}
              invalid={Boolean(err('ogImage'))}
            />
          </div>
        </FormField>
        <FormField label={m.editor_seo_twitter_card()}>
          <SegmentedControl<TwitterCard>
            fullWidth
            size="sm"
            aria-label={m.editor_seo_twitter_card()}
            value={seo.twitterCard ?? 'summary_large_image'}
            onValueChange={(value) =>
              set(
                'twitterCard',
                value === 'summary_large_image' ? undefined : value,
              )
            }
            options={[
              {
                value: 'summary_large_image',
                label: m.editor_seo_twitter_large(),
              },
              { value: 'summary', label: m.editor_seo_twitter_summary() },
            ]}
            data-testid={fieldId('twitterCard')}
          />
        </FormField>
      </Group>

      <Group
        title={m.editor_seo_group_answers()}
        summary={filled('answers')}
        open={open.answers}
        onToggle={() => toggle('answers')}
        testId="seo-group-answers"
      >
        <p className="text-caption font-normal text-text-muted">
          {m.editor_seo_answers_intro()}
        </p>
        <FormField
          label={m.editor_seo_summary()}
          htmlFor={fieldId('summary')}
          error={err('summary')}
          hint={m.editor_seo_summary_hint()}
        >
          <Textarea
            id={fieldId('summary')}
            data-field={`${SEO_KEY}.summary`}
            value={text('summary')}
            maxLength={SEO_LIMITS.summary}
            onChange={(event) => set('summary', event.target.value)}
          />
        </FormField>
        <FormField
          label={m.editor_seo_takeaways()}
          error={err('keyTakeaways') || errUnder('keyTakeaways')}
        >
          <div data-field={`${SEO_KEY}.keyTakeaways`}>
            <StringList
              id={fieldId('keyTakeaways')}
              items={seo.keyTakeaways ?? []}
              onChange={(items) => set('keyTakeaways', items)}
              max={SEO_LIMITS.takeaways}
              maxLength={SEO_LIMITS.takeaway}
              placeholder={m.editor_seo_takeaway_placeholder()}
              addLabel={m.editor_seo_add_takeaway()}
            />
          </div>
        </FormField>
        <FormField
          label={m.editor_seo_faq()}
          error={err('faq') || errUnder('faq')}
          hint={m.editor_seo_faq_hint()}
        >
          <div className="grid gap-3" data-field={`${SEO_KEY}.faq`}>
            {faq.map((item, index) => (
              <div
                key={index}
                className="grid gap-1.5 rounded-[10px] border border-border-default p-2.5"
              >
                <div className="flex items-start gap-1.5">
                  <Input
                    value={item.question}
                    inputSize="sm"
                    maxLength={SEO_LIMITS.faqQuestion}
                    placeholder={m.editor_seo_faq_question()}
                    aria-label={`${m.editor_seo_faq_question()} ${index + 1}`}
                    onChange={(event) =>
                      set(
                        'faq',
                        faq.map((row, i) =>
                          i === index
                            ? { ...row, question: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="quiet"
                    size="icon-sm"
                    aria-label={m.editor_seo_remove_item()}
                    onClick={() =>
                      set(
                        'faq',
                        faq.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <Trash />
                  </Button>
                </div>
                <Textarea
                  value={item.answer}
                  rows={2}
                  className="min-h-14 text-[13px]"
                  maxLength={SEO_LIMITS.faqAnswer}
                  placeholder={m.editor_seo_faq_answer()}
                  aria-label={`${m.editor_seo_faq_answer()} ${index + 1}`}
                  onChange={(event) =>
                    set(
                      'faq',
                      faq.map((row, i) =>
                        i === index
                          ? { ...row, answer: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </div>
            ))}
            {faq.length < SEO_LIMITS.faq ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="w-fit"
                onClick={() =>
                  set('faq', [...faq, { question: '', answer: '' }])
                }
              >
                <Plus />
                {m.editor_seo_add_faq()}
              </Button>
            ) : null}
          </div>
        </FormField>
      </Group>

      <Group
        title={m.editor_seo_group_structured()}
        summary={filled('structured')}
        open={open.structured}
        onToggle={() => toggle('structured')}
        testId="seo-group-structured"
      >
        <FormField
          label={m.editor_seo_schema_type()}
          htmlFor={fieldId('schemaType')}
          error={err('schemaType')}
          hint={m.editor_seo_schema_type_hint()}
        >
          <Select
            value={seo.schemaType ?? 'Article'}
            onValueChange={(value) =>
              set(
                'schemaType',
                value === 'Article' ? undefined : (value as SeoSchemaType),
              )
            }
          >
            <SelectTrigger id={fieldId('schemaType')} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEO_SCHEMA_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField
          label={m.editor_seo_about()}
          error={err('about') || errUnder('about')}
          hint={m.editor_seo_about_hint()}
        >
          <div className="grid gap-2" data-field={`${SEO_KEY}.about`}>
            {about.map((item, index) => (
              <div key={index} className="flex items-start gap-1.5">
                <div className="grid min-w-0 flex-1 gap-1">
                  <Input
                    value={item.name}
                    inputSize="sm"
                    maxLength={SEO_LIMITS.aboutName}
                    placeholder={m.editor_seo_about_name()}
                    aria-label={`${m.editor_seo_about_name()} ${index + 1}`}
                    onChange={(event) =>
                      set(
                        'about',
                        about.map((row, i) =>
                          i === index
                            ? { ...row, name: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                  <Input
                    value={item.sameAs ?? ''}
                    inputSize="sm"
                    type="url"
                    className="font-mono text-[12px]"
                    placeholder="https://www.wikidata.org/wiki/Q…"
                    aria-label={`${m.editor_seo_about_link()} ${index + 1}`}
                    onChange={(event) =>
                      set(
                        'about',
                        about.map((row, i) =>
                          i === index
                            ? { ...row, sameAs: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="quiet"
                  size="icon-sm"
                  aria-label={m.editor_seo_remove_item()}
                  onClick={() =>
                    set(
                      'about',
                      about.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash />
                </Button>
              </div>
            ))}
            {about.length < SEO_LIMITS.about ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="w-fit"
                onClick={() =>
                  set('about', [...about, { name: '', sameAs: '' }])
                }
              >
                <Plus />
                {m.editor_seo_add_about()}
              </Button>
            ) : null}
          </div>
        </FormField>
        <div className="grid gap-2" data-field={`${SEO_KEY}.author`}>
          <span className="text-[13px] leading-[18px] font-medium text-text-primary">
            {m.editor_seo_author()}
          </span>
          <Input
            value={seo.author?.name ?? ''}
            inputSize="sm"
            maxLength={SEO_LIMITS.authorName}
            placeholder={m.editor_seo_author_name()}
            aria-label={m.editor_seo_author_name()}
            onChange={(event) =>
              set('author', { ...seo.author, name: event.target.value })
            }
          />
          <Input
            value={seo.author?.url ?? ''}
            inputSize="sm"
            type="url"
            placeholder={m.editor_seo_author_url()}
            aria-label={m.editor_seo_author_url()}
            aria-invalid={Boolean(errors[`${SEO_KEY}.author.url`]) || undefined}
            onChange={(event) =>
              set('author', { ...seo.author, url: event.target.value })
            }
          />
          <Textarea
            value={seo.author?.bio ?? ''}
            rows={2}
            className="min-h-14 text-[13px]"
            maxLength={SEO_LIMITS.authorBio}
            placeholder={m.editor_seo_author_bio()}
            aria-label={m.editor_seo_author_bio()}
            onChange={(event) =>
              set('author', { ...seo.author, bio: event.target.value })
            }
          />
          {errUnder('author') ? (
            <p className="text-callout text-text-error" role="alert">
              {errUnder('author')}
            </p>
          ) : (
            <p className="text-caption font-normal text-text-muted">
              {m.editor_seo_author_hint()}
            </p>
          )}
        </div>
      </Group>

      <Group
        title={m.editor_seo_group_advanced()}
        summary={filled('advanced')}
        open={open.advanced}
        onToggle={() => toggle('advanced')}
        testId="seo-group-advanced"
      >
        <FormField
          label={m.editor_seo_canonical()}
          htmlFor={fieldId('canonicalUrl')}
          error={err('canonicalUrl')}
          hint={m.editor_seo_canonical_hint()}
        >
          <Input
            id={fieldId('canonicalUrl')}
            data-field={`${SEO_KEY}.canonicalUrl`}
            type="url"
            value={text('canonicalUrl')}
            placeholder={
              slug
                ? (entryPublicUrl(productionUrl, routePattern, slug) ?? '')
                : ''
            }
            onChange={(event) => set('canonicalUrl', event.target.value)}
          />
        </FormField>
        {(
          [
            ['noindex', m.editor_seo_noindex(), m.editor_seo_noindex_hint()],
            ['nofollow', m.editor_seo_nofollow(), m.editor_seo_nofollow_hint()],
          ] as const
        ).map(([key, label, hint]) => (
          <div
            key={key}
            className="flex items-center justify-between gap-4 rounded-[10px] border border-border-default bg-background-surface px-3 py-2.5"
          >
            <label
              htmlFor={fieldId(key)}
              className="grid min-w-0 cursor-pointer gap-0.5"
            >
              <span className="text-[14px] leading-5 font-medium text-text-primary">
                {label}
              </span>
              <span className="text-caption font-normal text-text-muted">
                {hint}
              </span>
            </label>
            <Switch
              id={fieldId(key)}
              checked={seo[key] === true}
              onCheckedChange={(next) => set(key, next || undefined)}
              data-testid={fieldId(key)}
            />
          </div>
        ))}
        <FormField
          label={m.editor_seo_jsonld()}
          htmlFor={fieldId('jsonLd')}
          error={err('jsonLd')}
          hint={m.editor_seo_jsonld_hint()}
        >
          <Textarea
            id={fieldId('jsonLd')}
            data-field={`${SEO_KEY}.jsonLd`}
            value={text('jsonLd')}
            spellCheck={false}
            className="font-mono text-[12px]"
            placeholder='{ "@context": "https://schema.org", "@type": "…" }'
            maxLength={SEO_LIMITS.jsonLd}
            onChange={(event) => set('jsonLd', event.target.value)}
          />
        </FormField>
      </Group>
    </div>
  )
}
