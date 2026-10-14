import { describe, expectTypeOf, it } from 'vitest'
import { createContent } from './content.js'
import type {
  Content,
  Entry,
  Global,
  GlobalKey,
  Globals,
  PreviewResult,
  ReferenceValue,
  SeoMeta,
} from './index.js'
import { globalSchema, schema } from './test-fixtures/schema.js'

type G = typeof globalSchema
type S = typeof schema

declare const content: Content<S, G>

describe('createContent with a global schema', () => {
  it('returns the Content type for the collection and global schemas', () => {
    expectTypeOf(createContent({ schema, globalSchema, dir: 'out' })).toEqualTypeOf<Content<S, G>>()
  })

  it('types content.globals from the global schema', () => {
    expectTypeOf(content.globals).toEqualTypeOf<Globals<G>>()
    expectTypeOf(content.globals.companyInfo).toEqualTypeOf<Global<'companyInfo', G>>()
  })
})

describe('globals: field values', () => {
  it('a required text field is a plain string', () => {
    expectTypeOf(content.globals.companyInfo.email).toEqualTypeOf<string>()
  })

  it('an optional text field is string, null or undefined', () => {
    expectTypeOf(content.globals.companyInfo.phoneNumber).toEqualTypeOf<string | null | undefined>()
  })

  it('a select field is the literal union of its options when optional', () => {
    expectTypeOf(content.globals.companyInfo.plan).toEqualTypeOf<'basic' | 'pro' | '' | null | undefined>()
  })

  it('an optional date field is a string, null or undefined', () => {
    expectTypeOf(content.globals.companyInfo.founded).toEqualTypeOf<string | null | undefined>()
  })

  it('a reference field is a typed reference to its collection', () => {
    expectTypeOf(content.globals.companyInfo.featuredAuthor).toEqualTypeOf<
      ReferenceValue<'authors'> | '' | null | undefined
    >()
  })

  it('a required text field in a seo global is still a plain string', () => {
    expectTypeOf(content.globals.homePage.heroTitle).toEqualTypeOf<string>()
  })

  it('field types match the Global<K> helper', () => {
    expectTypeOf<Global<'companyInfo', G>['email']>().toEqualTypeOf<string>()
  })

  it('resolve an optional reference to Entry | null through the generic resolve', () => {
    const info = content.globals.companyInfo
    expectTypeOf(content.resolve(info.featuredAuthor)).toEqualTypeOf<Entry<'authors', S> | null>()
  })
})

describe('globals: $seo', () => {
  it('exists as SeoMeta on a global with seo: true', () => {
    expectTypeOf(content.globals.homePage.$seo).toEqualTypeOf<SeoMeta>()
  })

  it('does not exist on a global without seo', () => {
    // @ts-expect-error companyInfo has no seo
    content.globals.companyInfo.$seo
  })

  it('is typed on Global<K> only for seo globals', () => {
    expectTypeOf<Global<'homePage', G>['$seo']>().toEqualTypeOf<SeoMeta>()
  })
})

describe('globals: keys', () => {
  it('GlobalKey lists the camel keys of the global schema', () => {
    expectTypeOf<GlobalKey<G>>().toEqualTypeOf<'companyInfo' | 'homePage'>()
  })

  it('rejects unknown globals', () => {
    // @ts-expect-error there is no global called nope
    content.globals.nope
  })

  it('rejects raw CMS global keys', () => {
    // @ts-expect-error the raw CMS key is not exposed
    content.globals['company-info']
  })

  it('rejects unknown fields on a global', () => {
    // @ts-expect-error there is no field called nope on companyInfo
    content.globals.companyInfo.nope
  })

  it('rejects raw CMS field keys on a global', () => {
    // @ts-expect-error camelCase field keys only
    content.globals.companyInfo['phone-number']
  })
})

describe('globals: preview', () => {
  it('previewGlobals resolves to the same typed globals object', () => {
    expectTypeOf(content.previewGlobals('token')).resolves.toEqualTypeOf<Globals<G>>()
    expectTypeOf(content.previewGlobals(null)).resolves.toEqualTypeOf<Globals<G>>()
  })

  it('previewGlobals accepts a token, a PreviewResult, or a falsy value', () => {
    const result: PreviewResult = {
      kind: 'global',
      global: 'company-info',
      entry: { id: 'g1', publishedAt: null, data: {} },
    }
    expectTypeOf(content.previewGlobals(result)).resolves.toEqualTypeOf<Globals<G>>()
    expectTypeOf(content.previewGlobals(undefined)).resolves.toEqualTypeOf<Globals<G>>()
    expectTypeOf(content.previewGlobals('token', { client: undefined })).resolves.toEqualTypeOf<
      Globals<G>
    >()
    // @ts-expect-error an entry-kind result is not a string or null
    content.previewGlobals({ kind: 'entry' })
  })
})

declare const loose: Content

describe('globals: unregistered schema', () => {
  it('reads any global key as a loose record without a registered schema', () => {
    expectTypeOf(loose.globals).toMatchTypeOf<Record<string, Record<string, unknown>>>()
    expectTypeOf(loose.globals.anything.whatever).toEqualTypeOf<unknown>()
  })
})
