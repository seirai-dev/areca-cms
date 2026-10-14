import type { ArecaClient } from './client.js'
import type {
  FieldType,
  ImageValue,
  PreviewResult,
  ReferenceValue,
  RichTextValue,
  SeoMeta,
} from './types.js'

/** Augmented by the generated `areca.gen.ts` with `schema` and `globals` (the site content schema). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Register {}

/** One field of the content schema, as embedded in a publication (camelCase keys are applied by the SDK types, not here). */
export type ContentSchemaField = {
  key: string
  type: FieldType
  required: boolean
  options?: readonly string[]
  collection?: string
  label?: string
  description?: string
  /** Editor heading for site content fields. */
  group?: string
}

export type ContentSchemaCollection = {
  key: string
  label?: string
  route: string
  fields: { readonly [fieldKey: string]: ContentSchemaField }
}

export type ContentSchema = { readonly [collectionKey: string]: ContentSchemaCollection }

/** One site content section, as the generated `globalSchema` declares it. */
export type ContentGlobalSchema = {
  key: string
  label?: string
  seo: boolean
  previewPath?: string
  fields: { readonly [fieldKey: string]: ContentSchemaField }
}

export type GlobalSchema = { readonly [globalKey: string]: ContentGlobalSchema }

/** Registered schema, or the loose `ContentSchema` when nothing is registered. */
export type RegisteredSchema = Register extends { schema: infer S extends ContentSchema }
  ? S
  : ContentSchema

/** Registered site content schema, or the loose `GlobalSchema` when nothing is registered. */
export type RegisteredGlobalSchema = Register extends { globals: infer G extends GlobalSchema }
  ? G
  : GlobalSchema

export type CollectionKey<S extends ContentSchema = RegisteredSchema> = keyof S & string

/** The schema entry of one collection; the loose schema for unknown keys. */
type CollectionOf<C extends string, S extends ContentSchema> = C extends keyof S
  ? S[C] extends infer K extends ContentSchemaCollection
    ? K
    : never
  : ContentSchemaCollection

/** The definition of field `F` of collection `C`; the loose field for unknown keys. */
type FieldDef<C extends string, F, S extends ContentSchema> =
  CollectionOf<C, S>['fields'] extends infer Fields
    ? F extends keyof Fields
      ? Fields[F]
      : ContentSchemaField
    : never

export type FieldKey<C extends string = string, S extends ContentSchema = RegisteredSchema> =
  keyof CollectionOf<C, S>['fields'] & string

type SelectOptionsOf<D> = D extends { options: readonly (infer O extends string)[] } ? O : never

/** Non-empty `options` give the literal union; otherwise plain `string`. */
type SelectValue<D> = [SelectOptionsOf<D>] extends [never] ? string : SelectOptionsOf<D>

type ReferenceTarget<D> = D extends { collection: infer T extends string } ? T : string

/** Value of a field that is present and not null. */
type PresentValue<D extends ContentSchemaField> = D['type'] extends
  | 'text'
  | 'textarea'
  | 'url'
  | 'slug'
  | 'date'
  | 'datetime'
  ? string
  : D['type'] extends 'select'
    ? SelectValue<D>
    : D['type'] extends 'number'
      ? number
      : D['type'] extends 'boolean'
        ? boolean
        : D['type'] extends 'image'
          ? ImageValue
          : D['type'] extends 'reference'
            ? ReferenceValue<ReferenceTarget<D>>
            : D['type'] extends 'richtext'
              ? RichTextValue
              : unknown

/** Extra empty-string value the CMS sends for optional fields of these types. */
type OptionalEmpty<D> = D extends { type: 'image' | 'reference' | 'richtext' }
  ? ''
  : D extends { type: 'select' }
    ? [SelectOptionsOf<D>] extends [never]
      ? never
      : ''
    : never

type ValueOf<D> = D extends ContentSchemaField
  ? FieldType extends D['type']
    ? unknown
    : D['required'] extends true
      ? PresentValue<D>
      : PresentValue<D> | OptionalEmpty<D> | null | undefined
  : unknown

/** Value type of field `F` in collection `C`, as the CMS sends it (optional fields include null and missing). */
export type FieldValue<C extends string, F, S extends ContentSchema = RegisteredSchema> = ValueOf<
  FieldDef<C, F, S>
>

/** Entry data: one key per field, typed from the schema. Homomorphic so hovers keep the field JSDoc. */
export type EntryData<C extends string = string, S extends ContentSchema = RegisteredSchema> = {
  [K in keyof CollectionOf<C, S>['fields']]: FieldValue<C, K, S>
}

export type Entry<C extends string = string, S extends ContentSchema = RegisteredSchema> = {
  id: string
  slug: string
  publishedAt: string | null
  collection: C
  data: EntryData<C, S>
  seo?: SeoMeta
}

export type AnyEntry<S extends ContentSchema = RegisteredSchema> = {
  [C in CollectionKey<S>]: Entry<C, S>
}[CollectionKey<S>]

/* ---------- where ---------- */

type EqOps<T> = { eq?: T; ne?: T }
type SetOps<T> = { in?: readonly T[]; notIn?: readonly T[] }
type OrderOps<T> = { gt?: T; gte?: T; lt?: T; lte?: T }
type ContainsOps = { contains?: string }
/** `isNull` only on optional fields. */
type NullOps<D> = D extends { required: true } ? unknown : { isNull?: boolean }
type Shorthand<T, Ops> = T | Ops

type WhereValue<D extends ContentSchemaField> = FieldType extends D['type']
  ? unknown
  : D['type'] extends 'text' | 'textarea' | 'url' | 'slug'
    ? Shorthand<string, EqOps<string> & SetOps<string> & ContainsOps & NullOps<D>>
    : D['type'] extends 'select'
      ? Shorthand<SelectValue<D>, EqOps<SelectValue<D>> & SetOps<SelectValue<D>> & NullOps<D>>
      : D['type'] extends 'date' | 'datetime'
        ? Shorthand<string, EqOps<string> & OrderOps<string> & NullOps<D>>
        : D['type'] extends 'number'
          ? Shorthand<number, EqOps<number> & OrderOps<number> & NullOps<D>>
          : D['type'] extends 'boolean'
            ? Shorthand<boolean, EqOps<boolean> & NullOps<D>>
            : D['type'] extends 'image' | 'richtext' | 'reference'
              ? D extends { required: true }
                ? never
                : NullOps<D>
              : never

type SortableFieldKey<C extends string, S extends ContentSchema> = {
  [F in FieldKey<C, S>]-?: FieldType extends FieldDef<C, F, S>['type']
    ? F
    : FieldDef<C, F, S>['type'] extends 'richtext' | 'image' | 'reference'
      ? never
      : F
}[FieldKey<C, S>]

type ReferenceFieldKey<C extends string, S extends ContentSchema> = {
  [F in FieldKey<C, S>]-?: FieldType extends FieldDef<C, F, S>['type']
    ? F
    : FieldDef<C, F, S> extends { type: 'reference' }
      ? F
      : never
}[FieldKey<C, S>]

export type Where<C extends string = string, S extends ContentSchema = RegisteredSchema> = {
  [F in FieldKey<C, S>]?: WhereValue<FieldDef<C, F, S>>
}

/* ---------- orderBy / query ---------- */

type OrderByObject<C extends string, S extends ContentSchema> = {
  [K in SortableFieldKey<C, S>]?: 'asc' | 'desc'
}

export type OrderBy<C extends string = string, S extends ContentSchema = RegisteredSchema> =
  | OrderByObject<C, S>
  | readonly OrderByObject<C, S>[]

export type QueryOptions<C extends string = string, S extends ContentSchema = RegisteredSchema> = {
  where?: Where<C, S>
  orderBy?: OrderBy<C, S>
  limit?: number
  offset?: number
  /** Expands reference fields one level. */
  with?: { [K in ReferenceFieldKey<C, S>]?: true }
}

/** Entry with the expanded references replaced by the target entry (or null). */
type ExpandedEntry<C extends string, W, S extends ContentSchema> = {
  id: string
  slug: string
  publishedAt: string | null
  collection: C
  seo?: SeoMeta
  data: {
    [F in keyof EntryData<C, S>]: F extends keyof W
      ? FieldDef<C, F, S> extends { required: true }
        ? Entry<ReferenceTarget<FieldDef<C, F, S>>, S> | null
        : Entry<ReferenceTarget<FieldDef<C, F, S>>, S> | null | undefined
      : EntryData<C, S>[F]
  }
}

export type QueryResult<
  C extends string = string,
  O = {},
  S extends ContentSchema = RegisteredSchema,
> = O extends { with: infer W extends object }
  ? keyof W extends never
    ? Entry<C, S>
    : ExpandedEntry<C, W, S>
  : Entry<C, S>

/* ---------- routes ---------- */

/** Replaces `$slug` in a route literal with `${string}`. A plain `string` route stays `string`. */
export type RoutePath<R extends string> = string extends R
  ? string
  : R extends `${infer Before}$slug${infer After}`
    ? `${Before}${string}${After}`
    : R

export type Href<C extends string = string, S extends ContentSchema = RegisteredSchema> = RoutePath<
  CollectionOf<C, S>['route']
>

/* ---------- site content (globals) ---------- */

/** The schema entry of one site content section; the loose one for unknown keys. */
type GlobalOf<K extends string, G extends GlobalSchema> = K extends keyof G
  ? G[K] extends infer D extends ContentGlobalSchema
    ? D
    : never
  : ContentGlobalSchema

export type GlobalKey<G extends GlobalSchema = RegisteredGlobalSchema> = keyof G & string

/** Field values of one site content section, typed exactly like entry data. Homomorphic so hovers keep the field JSDoc. */
export type GlobalData<K extends string = string, G extends GlobalSchema = RegisteredGlobalSchema> = {
  [F in keyof GlobalOf<K, G>['fields']]: ValueOf<GlobalOf<K, G>['fields'][F]>
}

/** `$seo` exists only on sections with `seo: true`. */
type GlobalSeo<K extends string, G extends GlobalSchema> = GlobalOf<K, G> extends { seo: true }
  ? { $seo: SeoMeta }
  : unknown

/** One site content section as the SDK returns it: its field values, plus `$seo` when SEO is on. */
export type Global<K extends string = string, G extends GlobalSchema = RegisteredGlobalSchema> = GlobalData<K, G> &
  GlobalSeo<K, G>

/** All site content sections, keyed by camel key. */
export type Globals<G extends GlobalSchema = RegisteredGlobalSchema> = {
  [K in GlobalKey<G>]: Global<K, G>
}

/* ---------- content object ---------- */

/** Value of a draft field: the optional variant, whatever `required` says (drafts may leave required fields empty). */
type DraftValueOf<D> = D extends ContentSchemaField
  ? FieldType extends D['type']
    ? unknown
    : PresentValue<D> | OptionalEmpty<D> | null | undefined
  : unknown

/** Draft entry data: one key per field, every value optional. Homomorphic so hovers keep the field JSDoc. */
export type DraftEntryData<
  C extends string = string,
  S extends ContentSchema = RegisteredSchema,
> = {
  [K in keyof CollectionOf<C, S>['fields']]: DraftValueOf<FieldDef<C, K, S>>
}

/** An entry built from unpublished draft data; see `PreviewEntry`. */
export type DraftEntry<C extends string = string, S extends ContentSchema = RegisteredSchema> = {
  id: string
  slug: string
  publishedAt: string | null
  collection: C
  data: DraftEntryData<C, S>
  seo?: SeoMeta
}

/**
 * Result of `content.preview()`. A complete draft has the same shape as a
 * published entry. An incomplete one (required fields empty, references or
 * images unresolvable) is still returned, with `issues` as
 * `<field>: <problem>` lines using camel field keys.
 */
export type PreviewEntry<S extends ContentSchema = RegisteredSchema> = {
  [C in CollectionKey<S>]:
    | { collection: C; slug: string; complete: true; entry: Entry<C, S>; issues: [] }
    | { collection: C; slug: string; complete: false; entry: DraftEntry<C, S>; issues: string[] }
}[CollectionKey<S>]

export type CollectionApi<C extends string = string, S extends ContentSchema = RegisteredSchema> = {
  all<const O extends QueryOptions<C, S> = {}>(options?: O & QueryOptions<C, S>): QueryResult<C, O, S>[]
  first<const O extends QueryOptions<C, S> = {}>(options?: O & QueryOptions<C, S>): QueryResult<C, O, S> | undefined
  get(slug: string): Entry<C, S> | undefined
  byId(id: string): Entry<C, S> | undefined
  href(entryOrSlug: Entry<C, S> | string): Href<C, S>
}

export type Content<
  S extends ContentSchema = RegisteredSchema,
  G extends GlobalSchema = RegisteredGlobalSchema,
> = {
  [C in CollectionKey<S>]: CollectionApi<C, S>
} & {
  resolve(ref: '' | null | undefined): null
  resolve<C extends CollectionKey<S>>(
    ref: ReferenceValue<C> | '' | null | undefined,
  ): Entry<C, S> | null
  href<C extends CollectionKey<S>>(ref: ReferenceValue<C> | Entry<C, S>): Href<C, S>
  preview(token: string, options?: { client?: ArecaClient }): Promise<PreviewEntry<S>>
  /** Published site content, keyed by camel key. Reads follow the pulled generation. */
  readonly globals: Globals<G>
  /**
   * Published site content, with the section replaced by its draft when `source`
   * is a site content preview token, or a preview result from `getPreviewEntry` /
   * `client.fetchPreview` (no request is made for a result). A falsy token, or an
   * entry preview, returns the published values.
   */
  previewGlobals(
    source: string | PreviewResult | null | undefined,
    options?: { client?: ArecaClient },
  ): Promise<Globals<G>>
}
