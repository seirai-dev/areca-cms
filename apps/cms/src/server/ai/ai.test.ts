import { describe, expect, it, vi } from 'vitest'

import { aiSeoSuggestionSchema } from '#/lib/ai-seo'
import type { AiSeoSuggestion } from '#/lib/ai-seo'
import type { Field } from '#/lib/types'

import { toModelOptions, verifyOpenRouterKey } from './openrouter.ts'
import { buildArticlePrompt, normalizeSuggestion } from './seo-generate.ts'

describe('toModelOptions', () => {
  it('keeps structured-output models and maps price and modalities', () => {
    const models = toModelOptions({
      data: [
        {
          id: 'b/vision',
          name: 'Vision',
          context_length: 200000,
          pricing: { prompt: '0.000003', completion: '0.000015' },
          architecture: { input_modalities: ['text', 'image'] },
          supported_parameters: ['structured_outputs', 'response_format'],
        },
        {
          id: 'a/plain',
          supported_parameters: ['response_format'],
        },
        {
          id: 'a/text',
          pricing: { prompt: 'n/a' },
          supported_parameters: ['structured_outputs'],
        },
      ],
    })
    expect(models.map((model) => model.id)).toEqual(['a/text', 'b/vision'])
    expect(models[1]).toEqual({
      id: 'b/vision',
      name: 'Vision',
      contextLength: 200000,
      promptPrice: 3,
      completionPrice: 15,
      supportsImages: true,
    })
    expect(models[0]).toMatchObject({ name: 'a/text', promptPrice: null })
    expect(toModelOptions(null)).toEqual([])
  })
})

describe('verifyOpenRouterKey', () => {
  it('maps 401 to false and 200 to true, and sends the key', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"data":{}}', { status: 200 }))
    await expect(verifyOpenRouterKey('bad', fetchFn)).resolves.toBe(false)
    await expect(verifyOpenRouterKey('good', fetchFn)).resolves.toBe(true)
    const init = fetchFn.mock.calls[1]?.[1]
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer good',
    )
  })

  it('throws on provider outages instead of calling the key invalid', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('', { status: 503 }))
    await expect(verifyOpenRouterKey('k', fetchFn)).rejects.toThrow('503')
  })
})

const fields: Field[] = [
  { key: 'slug', label: 'Slug', type: 'slug' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
  { key: 'body', label: 'Body', type: 'richtext' },
  { key: 'featured', label: 'Featured', type: 'boolean' },
]

describe('buildArticlePrompt', () => {
  it('includes the page URL, fields, markdown body, images and current SEO', () => {
    const prompt = buildArticlePrompt({
      site: { name: 'Acme', productionUrl: 'https://acme.test' },
      collectionLabel: 'Blog',
      routePattern: '/blog/$slug',
      fields,
      slug: 'hello',
      data: {
        slug: 'hello',
        title: 'Hello world',
        excerpt: 'Short intro',
        featured: true,
        body: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Section' }],
            },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Body text.' }],
            },
          ],
        },
        $seo: { focusKeyphrase: 'hello world' },
      },
      images: [
        { id: 'img1', url: 'u', filename: 'cat.jpg', alt: null },
        { id: 'img2', url: 'u', filename: 'dog.jpg', alt: 'A dog' },
      ],
    })
    expect(prompt).toContain('Page URL: https://acme.test/blog/hello')
    expect(prompt).toContain('Title: Hello world')
    expect(prompt).toContain('Excerpt: Short intro')
    expect(prompt).toContain('Featured: true')
    expect(prompt).toContain('## Section')
    expect(prompt).toContain('Body text.')
    expect(prompt).toContain('id=img1 file="cat.jpg" alt=MISSING ALT')
    expect(prompt).toContain('id=img2 file="dog.jpg" alt="A dog"')
    expect(prompt).toContain('focusKeyphrase: hello world')
  })
})

describe('normalizeSuggestion', () => {
  it('trims, clamps and drops what the editor cannot apply', () => {
    const raw: AiSeoSuggestion = {
      title: '  Title  ',
      description: 'x'.repeat(5000),
      focusKeyphrase: 'tea',
      ogTitle: '',
      ogDescription: '',
      schemaType: 'BlogPosting',
      about: [
        { name: 'Tea', sameAs: 'not a url' },
        { name: '', sameAs: '' },
      ],
      summary: 'Sum.',
      keyTakeaways: ['a', ' ', 'b'],
      faq: [
        { question: 'Q', answer: 'A' },
        { question: 'Q2', answer: '' },
      ],
      imageAlts: [
        { imageId: 'img1', alt: 'A cat' },
        { imageId: 'img2', alt: 'Already has alt' },
        { imageId: 'other-org', alt: 'Injected' },
      ],
    }
    expect(aiSeoSuggestionSchema.safeParse(raw).success).toBe(true)
    const out = normalizeSuggestion(raw, [
      { id: 'img1', url: 'u', filename: 'a', alt: null },
      { id: 'img2', url: 'u', filename: 'b', alt: 'Dog' },
    ])
    expect(out.title).toBe('Title')
    expect(out.description).toHaveLength(1000)
    expect(out.about).toEqual([{ name: 'Tea', sameAs: '' }])
    expect(out.keyTakeaways).toEqual(['a', 'b'])
    expect(out.faq).toEqual([{ question: 'Q', answer: 'A' }])
    expect(out.imageAlts).toEqual([{ imageId: 'img1', alt: 'A cat' }])
  })
})
