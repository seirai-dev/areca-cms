import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aiSeoSuggestionSchema } from '#/lib/ai-seo'
import type { AiSeoSuggestion } from '#/lib/ai-seo'
import type { Field } from '#/lib/types'
import type { Asset } from '#/server/assets'

import type { AiRuntimeConfig } from './settings.ts'

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  createOpenRouterText: vi.fn(),
  findOpenRouterModel: vi.fn(),
  loadAssetLookup: vi.fn(),
  getStorage: vi.fn(),
}))

vi.mock('@tanstack/ai', () => ({ chat: mocks.chat }))

vi.mock('@tanstack/ai-openrouter', () => ({
  createOpenRouterText: mocks.createOpenRouterText,
}))

vi.mock('./openrouter.ts', () => ({
  findOpenRouterModel: mocks.findOpenRouterModel,
}))

vi.mock('#/server/assets', () => ({
  assetUrl: (row: { storageKey: string }) =>
    `https://cms.test/api/assets/file/${row.storageKey}`,
  loadAssetLookup: mocks.loadAssetLookup,
}))

vi.mock('#/adapters', () => ({
  getStorage: mocks.getStorage,
}))

const { AiGenerationError, generateSeoSuggestion } =
  await import('./seo-generate.ts')

const config: AiRuntimeConfig = {
  apiKey: 'or-key-test',
  model: 'vendor/vision-model',
  systemPrompt: 'CONFIG SYSTEM PROMPT',
}

const suggestion: AiSeoSuggestion = {
  title: 'Generated title',
  description: 'Generated description',
  focusKeyphrase: 'generated phrase',
  ogTitle: '',
  ogDescription: '',
  schemaType: 'BlogPosting',
  about: [],
  summary: 'Short summary.',
  keyTakeaways: ['One'],
  faq: [],
  imageAlts: [],
}

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'hero', label: 'Hero', type: 'image' },
]

const baseInput = {
  config,
  sitePrompt: null as string | null,
  site: {
    name: 'Acme',
    productionUrl: 'https://acme.test',
    organizationId: 'org-1',
  },
  collectionLabel: 'Articles',
  routePattern: '/blog/$slug',
  fields,
  data: { title: 'Hello', hero: 'asset-1' },
  slug: 'hello',
}

function assetRow(overrides: Partial<Asset>): Asset {
  return {
    id: 'asset-1',
    storageKey: 'org-1/hero.png',
    originalFilename: 'hero.png',
    mimeType: 'image/png',
    altText: null,
    ...overrides,
  } as unknown as Asset
}

let pngBuffer: Buffer

type ChatOptions = {
  systemPrompts: string[]
  messages: { role: string; content: unknown[] }[]
  outputSchema: unknown
  middleware: {
    name: string
    onUsage?: (ctx: unknown, info: unknown) => void
  }[]
  abortController: AbortController
}

const lastChatOptions = (): ChatOptions =>
  mocks.chat.mock.calls.at(-1)?.[0] as ChatOptions

beforeEach(async () => {
  vi.clearAllMocks()
  pngBuffer = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 200, g: 30, b: 30 },
    },
  })
    .png()
    .toBuffer()

  mocks.createOpenRouterText.mockReturnValue({ kind: 'adapter' })
  mocks.findOpenRouterModel.mockResolvedValue({
    id: config.model,
    supportsImages: true,
  })
  mocks.loadAssetLookup.mockResolvedValue({
    byId: new Map([['asset-1', assetRow({})]]),
    byStorageKey: new Map(),
  })
  mocks.getStorage.mockReturnValue({
    get: vi.fn(async () => ({ body: pngBuffer })),
  })
  mocks.chat.mockResolvedValue(suggestion)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('generateSeoSuggestion: prompts and schema', () => {
  it('sends the configured prompt, then the site prompt when it is non-empty', async () => {
    await generateSeoSuggestion({
      ...baseInput,
      sitePrompt: '  Always mention our warranty.  ',
    })
    expect(lastChatOptions().systemPrompts).toEqual([
      'CONFIG SYSTEM PROMPT',
      'Site-specific instructions for Acme:\nAlways mention our warranty.',
    ])
  })

  it('omits the site prompt when it is null or whitespace', async () => {
    await generateSeoSuggestion({ ...baseInput, sitePrompt: null })
    expect(lastChatOptions().systemPrompts).toEqual(['CONFIG SYSTEM PROMPT'])

    await generateSeoSuggestion({ ...baseInput, sitePrompt: '   \n ' })
    expect(lastChatOptions().systemPrompts).toEqual(['CONFIG SYSTEM PROMPT'])
  })

  it('uses the shared output schema and the configured model and key', async () => {
    await generateSeoSuggestion(baseInput)
    expect(lastChatOptions().outputSchema).toBe(aiSeoSuggestionSchema)
    expect(mocks.createOpenRouterText).toHaveBeenCalledWith(
      'vendor/vision-model',
      'or-key-test',
      expect.objectContaining({ appTitle: 'Areca CMS' }),
    )
  })

  it('returns the normalised suggestion with the model id', async () => {
    const result = await generateSeoSuggestion(baseInput)
    expect(result.suggestion).toMatchObject({
      title: 'Generated title',
      focusKeyphrase: 'generated phrase',
      schemaType: 'BlogPosting',
    })
    expect(result.model).toBe('vendor/vision-model')
  })
})

describe('generateSeoSuggestion: images', () => {
  it('attaches resized JPEG parts when the model supports images', async () => {
    const result = await generateSeoSuggestion(baseInput)

    const content = lastChatOptions().messages[0]?.content ?? []
    const images = content.filter(
      (part): part is { type: string } =>
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === 'image',
    )
    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({
      type: 'image',
      source: { type: 'data', mimeType: 'image/jpeg' },
    })
    const value = (images[0] as unknown as { source: { value: string } }).source
      .value
    expect(value.length).toBeGreaterThan(0)
    // Base64 of a JPEG starts with the JPEG SOI marker.
    expect(Buffer.from(value, 'base64').subarray(0, 2)).toEqual(
      Buffer.from([0xff, 0xd8]),
    )
    expect(result.usedImages).toBe(true)
    expect(result.images).toEqual([
      {
        id: 'asset-1',
        url: 'https://cms.test/api/assets/file/org-1/hero.png',
        filename: 'hero.png',
        alt: null,
      },
    ])
  })

  it('sends no image parts when the model cannot read images, but still lists them', async () => {
    mocks.findOpenRouterModel.mockResolvedValue({
      id: config.model,
      supportsImages: false,
    })
    const result = await generateSeoSuggestion(baseInput)

    const content = lastChatOptions().messages[0]?.content ?? []
    expect(
      content.every((part) => (part as { type: string }).type === 'text'),
    ).toBe(true)
    expect(content).toHaveLength(1)
    expect(result.usedImages).toBe(false)
    expect(result.images).toHaveLength(1)
  })

  it('sends no image parts when the model is unknown to the catalogue', async () => {
    mocks.findOpenRouterModel.mockResolvedValue(null)
    const result = await generateSeoSuggestion(baseInput)
    expect(lastChatOptions().messages[0]?.content).toHaveLength(1)
    expect(result.usedImages).toBe(false)
  })
})

describe('generateSeoSuggestion: usage', () => {
  it('sums usage reported by the middleware across calls', async () => {
    mocks.chat.mockImplementation(async (options: ChatOptions) => {
      const usage = options.middleware.find(
        (item) => item.name === 'areca-usage',
      )
      usage?.onUsage?.(
        {},
        { promptTokens: 100, completionTokens: 20, cost: 0.5 },
      )
      usage?.onUsage?.({}, { promptTokens: 30, completionTokens: 5 })
      return suggestion
    })

    const result = await generateSeoSuggestion(baseInput)
    expect(result.usage).toEqual({
      promptTokens: 130,
      completionTokens: 25,
      cost: 0.5,
    })
  })

  it('leaves cost undefined when the provider does not report one', async () => {
    mocks.chat.mockImplementation(async (options: ChatOptions) => {
      options.middleware
        .find((item) => item.name === 'areca-usage')
        ?.onUsage?.({}, { promptTokens: 7, completionTokens: 3 })
      return suggestion
    })
    const result = await generateSeoSuggestion(baseInput)
    expect(result.usage).toEqual({ promptTokens: 7, completionTokens: 3 })
    expect(result.usage).not.toHaveProperty('cost')
  })
})

describe('generateSeoSuggestion: error mapping', () => {
  async function failWith(error: unknown) {
    mocks.chat.mockRejectedValueOnce(error)
    return generateSeoSuggestion(baseInput).then(
      () => {
        throw new Error('expected generateSeoSuggestion to reject')
      },
      (caught: unknown) => caught,
    )
  }

  it('maps structured-output validation failures to invalid_output', async () => {
    const error = Object.assign(new Error('bad shape'), {
      code: 'structured-output-validation-failed',
    })
    const caught = await failWith(error)
    expect(caught).toBeInstanceOf(AiGenerationError)
    expect(caught).toMatchObject({ code: 'invalid_output' })
  })

  it('maps a length cut-off to truncated', async () => {
    const caught = await failWith(
      new Error('Provider stopped with finish_reason=length'),
    )
    expect(caught).toMatchObject({ code: 'truncated' })
  })

  it('maps anything else to provider with status 502 and the provider text', async () => {
    const caught = await failWith(new Error('upstream exploded'))
    expect(caught).toBeInstanceOf(AiGenerationError)
    expect(caught).toMatchObject({ code: 'provider', status: 502 })
    expect((caught as Error).message).toBe(
      'The AI provider returned an error: upstream exploded',
    )
  })

  it('maps an abort after the timeout to timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mocks.chat.mockImplementation(
      (options: ChatOptions) =>
        new Promise((_resolve, reject) => {
          options.abortController.signal.addEventListener('abort', () =>
            reject(new Error('This operation was aborted')),
          )
        }),
    )

    const pending = generateSeoSuggestion(baseInput).then(
      () => {
        throw new Error('expected generateSeoSuggestion to reject')
      },
      (caught: unknown) => caught,
    )
    // The abort timer starts after the (real) image work, so wait for chat.
    await vi.waitFor(() => expect(mocks.chat).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(120_000)
    const caught = await pending
    expect(caught).toBeInstanceOf(AiGenerationError)
    expect(caught).toMatchObject({ code: 'timeout' })
  })
})
