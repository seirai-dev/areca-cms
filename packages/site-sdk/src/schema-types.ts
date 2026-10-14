import type { ArecaClient } from './client.js'
import type {
  FieldType,
  ImageValue,
  ReferenceValue,
  RichTextValue,
  SeoMeta,
} from './types.js'

/** Augmented by the generated `areca.gen.ts` with `interface Register { schema: typeof schema }`. */
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
}

export type ContentSchemaCollection = {
  key: string
  label?: string
  route: string
  fields: { readonly [fieldKey: string]: ContentSchemaField }
}

export type ContentSchema = { readonly [collectionKey: string]: ContentSchemaCollection }

/** Registered schema, or the loose `ContentSchema` when nothing is registered. */
export type RegisteredSchema = Register extends { schema: infer S extends ContentSchema }
  ? S
  : ContentSchema

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

/* ---------- content object ---------- */

export type PreviewEntry<S extends ContentSchema = RegisteredSchema> = {
  [C in CollectionKey<S>]: { collection: C; slug: string; entry: Entry<C, S> }
}[CollectionKey<S>]

export type CollectionApi<C extends string = string, S extends ContentSchema = RegisteredSchema> = {
  all<const O extends QueryOptions<C, S> = {}>(options?: O & QueryOptions<C, S>): QueryResult<C, O, S>[]
  first<const O extends QueryOptions<C, S> = {}>(options?: O & QueryOptions<C, S>): QueryResult<C, O, S> | undefined
  get(slug: string): Entry<C, S> | undefined
  byId(id: string): Entry<C, S> | undefined
  href(entryOrSlug: Entry<C, S> | string): Href<C, S>
}

export type Content<S extends ContentSchema = RegisteredSchema> = {
  [C in CollectionKey<S>]: CollectionApi<C, S>
} & {
  resolve(ref: '' | null | undefined): null
  resolve<C extends CollectionKey<S>>(
    ref: ReferenceValue<C> | '' | null | undefined,
  ): Entry<C, S> | null
  href<C extends CollectionKey<S>>(ref: ReferenceValue<C> | Entry<C, S>): Href<C, S>
  preview(token: string, options?: { client?: ArecaClient }): Promise<PreviewEntry<S>>
}
