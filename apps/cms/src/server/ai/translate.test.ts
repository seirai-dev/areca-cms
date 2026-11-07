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
  protectCode,
  restoreCode,
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
  {
    resolveAssetSrc: (id) =>
      id === 'asset-1' ? `/api/assets/file/${storageKey}` : null,
  },
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

describe('code in rich text', () => {
  const codeBody = markdownToRichText(
    'Run `npm i` first.\n\n```ts\n// Dutch comment\nconst a = `x`\n```',
  )
  const codeSource: EntryData = { ...source, body: codeBody }

  it('protects fenced blocks and inline code, and restores them verbatim', () => {
    const { markdown, code } = protectCode(
      'Run `npm i` first.\n\n```ts\n// Dutch comment\nconst a = `x`\n```',
    )
    // Fenced blocks are protected first, so they take the lower numbers.
    expect(code).toEqual([
      '```ts\n// Dutch comment\nconst a = `x`\n```',
      '`npm i`',
    ])
    expect(markdown).toBe('Run ⟦code-2⟧ first.\n\n⟦code-1⟧')
    expect(restoreCode(markdown, code)).toBe(
      'Run `npm i` first.\n\n```ts\n// Dutch comment\nconst a = `x`\n```',
    )
  })

  it('sends placeholders to the model, never the code', () => {
    const plan = planTranslation({
      fields,
      source: codeSource,
      target: {},
      seoEnabled: false,
      explicit: ['body'],
      assets,
    })
    const item = plan.items.find((entry) => entry.key === 'body')
    expect(item?.kind).toBe('richtext')
    if (item?.kind !== 'richtext') return
    expect(item.source).not.toContain('npm i')
    expect(item.source).not.toContain('Dutch comment')
    expect(item.source).toContain('⟦code-1⟧')
    expect(item.source).toContain('⟦code-2⟧')
  })

  it('restores the code the translation kept, byte for byte', () => {
    const doc = fromTranslatedMarkdown(
      'Voer ⟦code-1⟧ uit.\n\n⟦code-2⟧',
      'Run ⟦code-1⟧ first.\n\n⟦code-2⟧',
      assets,
      ['`npm i`', '```ts\n// Dutch comment\nconst a = `x`\n```'],
    )
    expect(JSON.stringify(doc)).toContain('"text":"npm i"')
    expect(JSON.stringify(doc)).toContain('// Dutch comment')
    expect(JSON.stringify(doc)).toContain('"language":"ts"')
  })

  it('skips the field when a placeholder is missing or duplicated', () => {
    const code = ['`npm i`']
    expect(
      fromTranslatedMarkdown('Voer uit.', 'Run ⟦code-1⟧.', assets, code),
    ).toBeNull()
    expect(
      fromTranslatedMarkdown(
        '⟦code-1⟧ and ⟦code-1⟧',
        'Run ⟦code-1⟧.',
        assets,
        code,
      ),
    ).toBeNull()
    expect(
      fromTranslatedMarkdown('⟦code-9⟧', 'Run ⟦code-1⟧.', assets, code),
    ).toBeNull()

    const result = normalizeTranslation(
      planTranslation({
        fields,
        source: codeSource,
        target: {},
        seoEnabled: false,
        explicit: ['body'],
        assets,
      }).items,
      { body: 'Voer uit.\n\n⟦code-2⟧' },
      assets,
    )
    expect(result.values).not.toHaveProperty('body')
    expect(result.skipped).toContain('body')
  })

  it('tells the model to keep placeholders unchanged', () => {
    expect(TRANSLATE_SYSTEM_PROMPT).toContain('⟦code-1⟧')
    expect(TRANSLATE_SYSTEM_PROMPT).toContain('Copy each placeholder exactly')
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
    expect(request).toContain(
      'Markdown fields (keep the Markdown syntax): body.',
    )
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

describe('entry links in translation', () => {
  const ETHIOPIA = '7f1c2a40-1111-4b2c-9d3e-0a1b2c3d4e5f'
  const OTHER = '0b9e8d7c-2222-4a1b-8c3d-5e6f7a8b9c0d'
  const linkAttrs = {
    href: '/blog/ethiopia#herkomst',
    entryId: ETHIOPIA,
    collection: 'articles',
    anchor: 'herkomst',
  }
  const linkedBody = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Lees ' },
          {
            type: 'text',
            text: 'de herkomst',
            marks: [{ type: 'link', attrs: linkAttrs }],
          },
          { type: 'text', text: ' eerst.' },
        ],
      },
    ],
  }
  const linkedFields: Field[] = [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'body', label: 'Body', type: 'richtext' },
  ]
  const translate = (answer: Record<string, unknown>) => {
    mocks.chat.mockResolvedValueOnce(answer)
    return translateContent({
      config,
      sitePrompt: null,
      siteName: 'Acme',
      fromName: 'Dutch',
      toName: 'English',
      fields: linkedFields,
      source: { title: 'Kenya', body: linkedBody },
      target: {},
      seoEnabled: false,
      assets,
    })
  }

  it('sends the entry link as entry:<id>#section and keeps the id, collection and section', async () => {
    const result = await translate({
      title: 'Kenya',
      body: `Read [the origin](entry:${ETHIOPIA}#herkomst) first.`,
    })
    const request = lastChat().messages[0]?.content[0]?.content ?? ''
    expect(request).toContain(`(entry:${ETHIOPIA}#herkomst)`)
    expect(request).not.toContain('/blog/ethiopia')
    expect(linkMarks(result.values.body)).toEqual([
      { text: 'the origin', attrs: linkAttrs },
    ])
    expect(result.warnings).toEqual([])
  })

  it('drops an entry link the translation invents, keeps its text and warns', async () => {
    const result = await translate({
      title: 'Kenya',
      body: `Read [the origin](entry:${ETHIOPIA}#herkomst) and [elsewhere](entry:${OTHER}).`,
    })
    expect(linkMarks(result.values.body).map((link) => link.attrs)).toEqual([
      linkAttrs,
    ])
    expect(JSON.stringify(result.values.body)).toContain('elsewhere')
    expect(result.warnings).toEqual([expect.stringContaining(OTHER)])
  })

  it('tells the model to keep entry destinations exactly as written', () => {
    expect(TRANSLATE_SYSTEM_PROMPT).toContain('entry:<id>#section')
  })
})

/** The link marks of a stored rich text document, with the text they cover. */
function linkMarks(
  json: unknown,
): { text?: string; attrs: Record<string, unknown> }[] {
  const out: { text?: string; attrs: Record<string, unknown> }[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const { text, marks, content } = node as {
      text?: string
      marks?: { type: string; attrs?: Record<string, unknown> }[]
      content?: unknown[]
    }
    for (const mark of marks ?? []) {
      if (mark.type === 'link') out.push({ text, attrs: mark.attrs ?? {} })
    }
    for (const child of content ?? []) visit(child)
  }
  visit(json)
  return out
}
