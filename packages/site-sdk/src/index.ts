export { createArecaClient } from './client.js'
export type { ArecaClient, ArecaClientOptions } from './client.js'
export { defineSiteContent, manifestFromConfig } from './config.js'
export type {
  AnyEntry,
  CollectionApi,
  CollectionKey,
  Content,
  ContentSchema,
  ContentSchemaCollection,
  ContentSchemaField,
  Entry,
  EntryData,
  FieldKey,
  FieldValue,
  Href,
  OrderBy,
  PreviewEntry,
  QueryOptions,
  QueryResult,
  Register,
  RegisteredSchema,
  RoutePath,
  Where,
} from './schema-types.js'
export { getPreviewEntry, previewHeaders } from './preview.js'
export { seoHead, seoHeadHtml, seoJsonLd } from './seo.js'
export type { HeadLink, HeadMeta, HeadScript, SeoHeadOptions, SeoHeadResult } from './seo.js'
export { richTextDocument, richTextHtml, richTextMarkdown } from './rich-text.js'
export type {
  AssetsConfig,
  CollectionConfig,
  Field,
  FieldType,
  ImageValue,
  PreviewResult,
  PulledContentManifest,
  ReferenceValue,
  RichTextValue,
  SeoMeta,
  SiteContentConfig,
  SiteManifest,
  Snapshot,
  SnapshotAsset,
  SnapshotEntry,
} from './types.js'
