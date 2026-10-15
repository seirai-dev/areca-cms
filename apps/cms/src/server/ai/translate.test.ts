import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EntryData, Field } from '#/lib/types'
import { markdownToRichText } from '#/server/richtext/from-markdown'

import type { AiRuntimeConfig } from './settings.ts'

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  createOpenRouterText: vi.fn(),
}))

vi.mock('@tanstack/ai', () => ({ chat: mocks.chat }))
vi.mock('@tanstack/ai-openrouter', () => ({
  createOpenRouterText: mocks.createOpenRouterText,
}))

const { AiGenerationError } = await import('./seo-generate.ts')
const {
  fromTranslatedMarkdown,
  normalizeTranslation,
  planTranslation,
  translateContent,
  translationRequest,
  TRANSLATE_SYSTEM_PROMPT,
} = await import('./translate.ts')

const config: AiRuntimeConfig = {
  apiKey: 'or-key-test',
  model: 'vendor/text-model',
  systemPrompt: 'SEO PROMPT (not used for translation)',
}

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
  { key: 'body', label: 'Body', type: 'richtext' },
  { key: 'salary', label: 'Salary', type: 'number' },
  { key: 'website', label: 'Website', type: 'url', translatable: true },
  { key: 'pinned', label: 'Pinned', type: 'boolean' },
]

const storageKey = 'org-1/hero.png'
const assets = {
  byId: new Map([['asset-1', { storageKey }]]),
  byStorageKey: new Map([[storageKey, { id: 'asset-1' }]]),
}

const bodyDoc = markdownToRichText(
  '## Over de baan\n\nWerk bij [ons team](https://example.com).\n\n![Kantoor](asset:asset-1)',
  { resolveAssetSrc: (id) => (id === 'asset-1' ? `/api/assets/file/${storageKey}` : null) },
)

const source: EntryData = {
  title: 'Backend ontwikkelaar',
  slug: 'backend-ontwikkelaar',
  excerpt: 'Werk aan onze API.',
  body: bodyDoc,
  salary: 4000,
  pinned: true,
  $seo: {
    title: 'Backend ontwikkelaar | Acme',
    description: 'Vacature voor een backend ontwikkelaar.',
    summary: 'Samenvatting.',
    keyTakeaways: ['Remote werk', 'Goed salaris'],
    faq: [{ question: 'Hoeveel uur?', answer: '40 uur.' }],
  },
}

type ChatOptions = {
  systemPrompts: string[]
  messages: { role: string; content: { type: string; content: string }[] }[]
  outputSchema: { parse: (value: unknown) => unknown }
  modelOptions: unknown
}

const lastChat = (): ChatOptions =>
  mocks.chat.mock.calls.at(-1)?.[0] as ChatOptions

beforeEach(() => {
  vi.clearAllMocks()
})

describe('planTranslation', () => {
  it('translates only the translatable fields that are empty in the target', () => {
    const plan = planTranslation({
      fields,
      source,
      target: { title: 'Backend developer' },
      seoEnabled: false,
      assets,
    })
    const keys = plan.items.map((item) => item.key)
    expect(keys).toEqual(['excerpt', 'body'])
    expect(plan.skipped).toEqual(['title', 'website'])
  })

  it('leaves shared and non-text fields alone, without listing them', () => {
    const plan = planTranslation({
      fields,
      source,
      target: {},
      seoEnabled: false,
      assets,
    })
    expect(plan.items.map((item) => item.key)).toEqual([
      'title',
      'excerpt',
      'body',
    ])
    expect(plan.skipped).not.toContain('salary')
    expect(plan.skipped).not.toContain('slug')
  })

  it('translates explicitly listed keys even when the target has them', () => {
    const plan = planTranslation({
      fields,
      source,
      target: { title: 'Backend developer' },
      seoEnabled: false,
      explicit: ['title'],
      assets,
    })
    expect(plan.items.map((item) => item.key)).toEqual(['title'])
  })

  it('reports explicitly listed keys it cannot translate', () => {
    const plan = planTranslation({
      fields,
      source,
      target: {},
      seoEnabled: false,
      explicit: ['salary', 'pinned', 'nope', 'website'],
      assets,
    })
    expect(plan.items).toEqual([])
    expect(plan.skipped).toEqual(
      expect.arrayContaining(['salary', 'pinned', 'nope']),
    )
  })

  it('includes translatable SEO values when SEO is on, and only the empty ones', () => {
    const plan = planTranslation({
      fields,
      source,
      target: { $seo: { description: 'Existing description' } },
      seoEnabled: true,
      assets,
    })
    const keys = plan.items.map((item) => item.key)
    expect(keys).toEqual(
      expect.arrayContaining([
        'seo.title',
        'seo.summary',
        'seo.keyTakeaways',
        'seo.faq',
      ]),
    )
    expect(keys).not.toContain('seo.description')
  })

  it('leaves SEO out of the plan when the section has no SEO', () => {
    const plan = planTranslation({
      fields,
      source,
      target: {},
      seoEnabled: false,
      assets,
    })
    expect(plan.items.some((item) => item.key.startsWith('seo.'))).toBe(false)
  })

  it('sends rich text as Markdown with asset references, not stored JSON', () => {
    const plan = planTranslation({
      fields,
      source,
      target: {},
      seoEnabled: false,
      explicit: ['body'],
      assets,
    })
    const body = plan.items.find((item) => item.key === 'body')
    expect(body?.kind).toBe('richtext')
    const markdown = body?.kind === 'richtext' ? body.source : ''
    expect(markdown).toContain('![Kantoor](asset:asset-1)')
    expect(markdown).toContain('[ons team](https://example.com)')
  })
})

describe('fromTranslatedMarkdown', () => {
  it('returns a stored document that keeps the image and the link', () => {
    const doc = fromTranslatedMarkdown(
      '## Over de baan\n\nWork at [our team](https://example.com).\n\n![Office](asset:asset-1)',
      '![Kantoor](asset:asset-1)',
      assets,
    )
    expect(JSON.stringify(doc)).toContain(`/api/assets/file/${storageKey}`)
    expect(JSON.stringify(doc)).toContain('https://example.com')
  })

  it('refuses output that drops an image the source had', () => {
    const doc = fromTranslatedMarkdown(
      '## Over de baan\n\nWork at our team.',
      '![Kantoor](asset:asset-1)',
      assets,
    )
    expect(doc).toBeNull()
  })

  it('refuses output that uses an asset the organisation does not have', () => {
    const doc = fromTranslatedMarkdown(
      '![Office](asset:asset-99)',
      '![Kantoor](asset:asset-1)',
      assets,
    )
    expect(doc).toBeNull()
  })
})

describe('normalizeTranslation', () => {
  it('clamps text to the stored limits and reports empty answers as skipped', () => {
    const plan = planTranslation({
      fields,
      source,
      target: {},
      seoEnabled: true,
      explicit: ['title', 'excerpt', 'seo.title'],
      assets,
    })
    const result = normalizeTranslation(
      plan.items,
      {
        title: 'x'.repeat(2_000),
        excerpt: '   ',
        'seo.title': 'Backend developer | Acme',
      },
      assets,
    )
    expect((result.values.title as string).length).toBe(1_000)
    expect(result.values).not.toHaveProperty('excerpt')
    expect(result.skipped).toContain('excerpt')
    expect(result.seo).toEqual({ title: 'Backend developer | Acme' })
  })
})

describe('translationRequest and the system prompt', () => {
  it('names both languages, lists the Markdown fields and sends the keys', () => {
    const request = translationRequest({
      fromName: 'Dutch',
      toName: 'English',
      items: [
        { key: 'title', kind: 'text', source: 'Titel', max: 1_000 },
        { key: 'body', kind: 'richtext', source: '## Kop' },
      ],
    })
    expect(request).toContain('Translate from Dutch to English.')
    expect(request).toContain('Markdown fields (keep the Markdown syntax): body.')
    expect(request).toContain('"title": "Titel"')
  })

  it('tells the model to keep formatting, URLs, names and placeholders', () => {
    expect(TRANSLATE_SYSTEM_PROMPT).toContain('Keep URLs')
    expect(TRANSLATE_SYSTEM_PROMPT).toContain('asset:<id>')
    expect(TRANSLATE_SYSTEM_PROMPT).toContain('natural tone')
  })
})

describe('translateContent', () => {
  it('makes one structured request and returns values without saving', async () => {
    mocks.chat.mockResolvedValueOnce({
      title: 'Backend developer',
      excerpt: 'Work on our API.',
      body: '## Over de baan\n\nWork at [our team](https://example.com).\n\n![Office](asset:asset-1)',
      'seo.title': 'Backend developer | Acme',
      'seo.description': 'x',
      'seo.summary': 'Summary.',
      'seo.keyTakeaways': ['Remote work', 'Good salary'],
      'seo.faq': [{ question: 'How many hours?', answer: '40 hours.' }],
    })
    const result = await translateContent({
      config,
      sitePrompt: 'Use a friendly tone.',
      siteName: 'Acme',
      fromName: 'Dutch',
      toName: 'English',
      fields,
      source,
      target: {},
      seoEnabled: true,
      assets,
    })

    expect(mocks.chat).toHaveBeenCalledTimes(1)
    expect(mocks.createOpenRouterText).toHaveBeenCalledWith(
      config.model,
      config.apiKey,
      expect.any(Object),
    )
    const options = lastChat()
    expect(options.systemPrompts[0]).toBe(TRANSLATE_SYSTEM_PROMPT)
    expect(options.systemPrompts).not.toContain(config.systemPrompt)
    expect(options.systemPrompts.join('\n')).toContain('Use a friendly tone.')
    expect(options.messages[0]?.content[0]?.content).toContain(
      'Translate from Dutch to English.',
    )
    expect(options.messages[0]?.content[0]?.content).toContain('asset:asset-1')

    expect(result.values.title).toBe('Backend developer')
    expect(result.values.excerpt).toBe('Work on our API.')
    expect(JSON.stringify(result.values.body)).toContain(
      `/api/assets/file/${storageKey}`,
    )
    expect(result.seo).toMatchObject({
      title: 'Backend developer | Acme',
      keyTakeaways: ['Remote work', 'Good salary'],
      faq: [{ question: 'How many hours?', answer: '40 hours.' }],
    })
    expect(result.skipped).toEqual(['website'])
    expect(result.model).toBe(config.model)
  })

  it('makes no model call when nothing needs translating', async () => {
    const result = await translateContent({
      config,
      sitePrompt: null,
      siteName: 'Acme',
      fromName: 'Dutch',
      toName: 'English',
      fields,
      source: { title: 'Titel' },
      target: { title: 'Title' },
      seoEnabled: false,
      assets,
    })
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(result.values).toEqual({})
    expect(result.skipped).toEqual(['title', 'website'])
  })

  it('maps a malformed model answer to an invalid_output error', async () => {
    mocks.chat.mockRejectedValueOnce(
      new Error('Failed to parse structured output'),
    )
    const error = await translateContent({
      config,
      sitePrompt: null,
      siteName: 'Acme',
      fromName: 'Dutch',
      toName: 'English',
      fields,
      source,
      target: {},
      seoEnabled: false,
      assets,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiGenerationError)
    expect((error as InstanceType<typeof AiGenerationError>).code).toBe(
      'invalid_output',
    )
  })

  it('maps a provider failure without echoing request content', async () => {
    mocks.chat.mockRejectedValueOnce(new Error('rate limit exceeded'))
    const error = await translateContent({
      config,
      sitePrompt: null,
      siteName: 'Acme',
      fromName: 'Dutch',
      toName: 'English',
      fields,
      source,
      target: {},
      seoEnabled: false,
      assets,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiGenerationError)
    expect((error as Error).message).toContain('rate limit exceeded')
    expect((error as Error).message).not.toContain('Backend ontwikkelaar')
  })
})
