# `@areca-cms/site-sdk`

Connect a Node.js website to an existing Areca CMS site. The SDK publishes the
site's content schema, downloads the current published snapshot, and fetches
draft entries for preview. It does not create a CMS site or generate frontend
routes.

For a step-by-step integration guide, see the repository's
[SDK guide](../../docs/SDK.md).

Requires Node.js 22.6 or newer. Node 24 LTS is recommended for direct import of
the TypeScript config by `areca manifest push`. The SDK is ESM-only and has no
React dependency.

## Quick start

Create a site in the CMS and copy its **site token**. Install the SDK in the
website project:

```bash
pnpm add @areca-cms/site-sdk
pnpm exec areca init
```

The interactive command asks for the CMS URL, site token, and site key. It
creates `areca.config.ts`, `.env.example`, a gitignored `.env.local`, and an
empty generated-content directory. Add collection definitions to the config,
then configure the **schema token** in `.env.local` before pushing the schema:

```dotenv
ARECA_CMS_URL=https://cms.example.com
ARECA_SITE_TOKEN=site-token-from-site-settings
ARECA_SCHEMA_TOKEN=schema-token-from-site-settings
```

The site token reads manifests and snapshots. A separate, signed preview token
authorizes each draft preview. The schema token publishes schema changes and
belongs only in the schema-authoring environment. Keep credentials out of
source control and public browser code. The CLI loads `.env.local`
and then `.env` in its current directory; existing process environment values
take precedence.

Declare a collection in `areca.config.ts`:

```ts
import { defineSiteContent } from "@areca-cms/site-sdk";

export default defineSiteContent({
  siteKey: "acme-site",
  collections: {
    articles: {
      route: "/blog/$slug",
      label: "Articles",
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "body", label: "Body", type: "richtext" },
        { key: "cover", label: "Cover", type: "image" },
      ],
    },
  },
});
```

Publish that schema to the CMS, publish at least one content release in the
CMS, and download the published content:

```bash
pnpm exec areca manifest push
pnpm exec areca pull
```

The default output is `src/generated/content/`. Use `readContent()` from a
server loader or build script to read the JSON snapshot. Do not import the
site token or call the CMS from a public browser bundle.

## CLI

| Command                                               | Purpose                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `areca init`                                          | Create frontend config and environment-file scaffolding.                                                |
| `areca pull [--out <directory>] [--publication <id>]` | Download the current published snapshot; default output is `src/generated/content`.                     |
| `areca manifest push [config]`                        | Send the local config to the CMS. Default config is `./areca.config.ts`. Requires `ARECA_SCHEMA_TOKEN`. |
| `areca manifest pull [--config <path>] [--yes]`       | Replace the local config with enabled CMS collections.                                                  |
| `areca sync-manifest [config]`                        | Deprecated alias for `areca manifest push`.                                                             |
| `areca run -- <command>`                              | Run a child command with SDK-loaded environment files.                                                  |

`areca init` accepts `--cms-url`, `--token`, `--site-key`, `--out`, `--config`,
`--yes`/`-y`, and `--force`. Use flags with `--yes` in automation. `--force`
allows init to overwrite its config and `.env.example` outputs.

`manifest pull` replaces the entire config file, including comments and helper
code. It prints a collection diff and prompts before overwriting a config that
already defines collections. `--yes` skips the prompt; in non-interactive use,
it is required when collections already exist. The local `siteKey` is kept. If
there is no config, set `ARECA_SITE_KEY` or run `areca init` first.

`areca pull` exits with an error if the site has no published snapshot. Publish
content in the CMS before adding it to a production build. Pulls write an immutable generation, then atomically replace `manifest.json` to select it:

```text
src/generated/content/
├── manifest.json       # publication ID, hash, counts, and generation pointer
└── .publications/
    └── publication-<generation>/
        └── articles.json
```

Use `readContent()` instead of importing a flat `<collection>.json` file. It follows
the current manifest and rejects collections absent from that publication. Legacy
flat outputs remain readable. A failed pull preserves the complete prior generation;
old generations remain for readers that captured their manifest. Generated output
is normally ephemeral. To prune it, delete the output directory when no readers
are using it and pull again. Direct file imports do not receive this atomic-switch
guarantee.

`areca pull` honors `ARECA_SNAPSHOT_ID` from deployment builds, or an explicit
`--publication <id>`. Empty and `0` values select the current live/demo publication.
The SDK checks that the CMS returned the requested publication before writing.

The generated files should usually be ignored by Git and created during local
development or the build. Pull rejects unsafe collection names and refuses
symbolic-link output files.

## Read snapshot content

Use the `@areca-cms/site-sdk/pull` export from server-side code:

```ts
import { readContent } from "@areca-cms/site-sdk/pull";
import type {
  ImageValue,
  RichTextValue,
  SnapshotEntry,
} from "@areca-cms/site-sdk";

type Article = SnapshotEntry & {
  data: { title: string; body: RichTextValue; cover: ImageValue | null };
};

const articles = readContent<Article>("src/generated/content", "articles");
const article = articles.find((item) => item.slug === "hello-world");
```

Each entry has `id`, `slug`, `publishedAt`, `data`, and optional `seo`. The
CMS schema supplies the `data` fields; define a TypeScript type for the content
your site expects. Images include a URL, dimensions, alt text, and MIME type.
References include the target collection, slug, and ID.

For one-time content loads in Node, the client can pull files directly:

```ts
import { createArecaClient } from "@areca-cms/site-sdk";
import { pullContent } from "@areca-cms/site-sdk/pull";

const client = createArecaClient();
const snapshot = await pullContent({ outDir: "src/generated/content", client });
console.log(snapshot.publicationId);
```

`readContentManifest(directory)` captures the current publication pointer. Pass it
as the third argument to each `readContent()` call when reading multiple collections
that must belong to one publication.

`readContent<T>(directory, collectionKey, capturedManifest?)` reads the collection array and
returns it as `T[]`. If the content has not been pulled, it explains that you
need to run `areca pull` first.

## Render rich text

Rich-text values contain an escaped Markdown export, a TanStack Markdown document
that preserves the visual editor structure, and a static HTML fallback from that
document. Literal Markdown typed into the editor stays literal in published content.
Complex tables use public component nodes to retain mixed headers, merged cells,
and multiple paragraphs. The Markdown export can simplify structures outside its
syntax profile; use the document for faithful rendering. The helper supports older snapshots that
contain Markdown without the parsed document:

```tsx
import { Markdown } from "@tanstack/markdown/react";
import { richTextComponents } from "@areca-cms/site-sdk/rich-text-react";
import { richTextDocument } from "@areca-cms/site-sdk";
import type { RichTextValue } from "@areca-cms/site-sdk";

export function ArticleBody({ body }: { body: RichTextValue }) {
  return (
    <Markdown components={richTextComponents()}>
      {richTextDocument(body)}
    </Markdown>
  );
}
```

Use the optional `rich-text-react` adapter for React rendering. Explicitly resized
editor images use safe `img` component nodes carrying numeric width/height; the
adapter removes TanStack's generated empty children from these void elements.
Pass your own map as `richTextComponents(myComponents)` to keep custom image
rendering. Keep `max-width: 100%` while respecting supplied dimensions; forcing
`width: 100%` overrides the author's chosen size. The CLI and core SDK do not
import React. Static HTML already contains the chosen dimensions. Plain images
remain standard Markdown image nodes.

`richTextMarkdown(value)` returns the Markdown source. `richTextHtml(value)`
returns the CMS-rendered static HTML string; only render trusted CMS content as
HTML. For custom rendering, pass a `components` map to `Markdown`. The SDK uses
`@tanstack/markdown` 1.0.0; keep the renderer version aligned with the CMS and SDK.

## SEO metadata

For the editor and agency workflow that produces these metadata fields, see
the repository's [SEO guide](../../docs/SEO.md). For CMS roles and release
steps, see the [editor guide](../../docs/CMS_GUIDE.md) and
[agency admin guide](../../docs/ADMIN_GUIDE.md).

Newer snapshots include a resolved `entry.seo` object. Older snapshots may not,
so accept `undefined`. `seoHead()` produces TanStack Router head data, including
title, description, canonical URL, robots, Open Graph, Twitter, author, and
JSON-LD tags:

```tsx
import { seoHead } from "@areca-cms/site-sdk";
import type { SnapshotEntry } from "@areca-cms/site-sdk";

export function articleHead(entry: SnapshotEntry) {
  return seoHead(entry.seo, { titleTemplate: "%s · Acme" });
}
```

The CMS title has no site suffix. `titleTemplate` can be a string containing
`%s` or a function; `siteName` overrides `og:site_name`. Missing values are
omitted. Render `seo.summary`, `seo.keyTakeaways`, and FAQ answers in the page
when using related structured data so the metadata matches visible content.

For server-rendered templates such as Astro, `seoHeadHtml()` returns escaped
head tags and safe inline JSON-LD:

```astro
---
import { seoHeadHtml } from '@areca-cms/site-sdk/seo'
const { entry } = Astro.props
---
<head set:html={seoHeadHtml(entry.seo, { titleTemplate: '%s · Acme' })} />
```

`seoJsonLd(seo)` returns JSON strings safe to place inside a JSON-LD script.

## Draft preview

The CMS preview URL includes an opaque, short-lived `token` query parameter.
Fetch preview data on the server and mark the response non-indexable and
uncacheable:

```ts
import { getPreviewEntry, previewHeaders } from "@areca-cms/site-sdk";

const preview = await getPreviewEntry({ token });
const headers = previewHeaders();
// Apply headers to the server response.
// Render preview.entry using the same view as a published entry.
```

`previewHeaders()` returns `X-Robots-Tag: noindex, nofollow` and
`Cache-Control: no-store`. The preview token is passed to the CMS in the URL,
so do not log it, persist it, or expose it beyond the preview request. Show a
clear error for expired/invalid tokens (401) and missing preview entries (404).

## Programmatic client and errors

`createArecaClient({ cmsUrl?, siteToken?, schemaToken? })` uses the matching
environment variables when options are omitted:

```ts
import { createArecaClient } from "@areca-cms/site-sdk";

const client = createArecaClient();
const manifest = await client.fetchManifest();
const snapshot = await client.fetchSnapshot();
await client.syncManifest(config);
const preview = await client.fetchPreview(previewToken);
```

The client methods are `fetchManifest()`, `fetchSnapshot()`,
`syncManifest(config)`, and `fetchPreview(token)`. Use
`fetchSnapshot({ publicationId })` to request an exact frozen publication. It throws readable errors
when required settings are missing, the CMS cannot be reached, or an HTTP
request fails. A missing publication gives a specific publish-first error.
Errors from HTTP responses include the status and CMS error detail when
available. The CLI prints the error and exits non-zero.

## Schema rules

Collection and field keys start with an ASCII letter and contain at most 64
ASCII letters, digits, `_`, or `-`. Reserved names include `manifest`,
`constructor`, `prototype`, `__proto__`, and Windows device names. Field types
are `text`, `textarea`, `richtext`, `image`, `date`, `datetime`, `select`,
`reference`, `slug`, `boolean`, `number`, and `url`. `select` uses `options`,
`reference` uses `collection`, and date ordering can use `after` to refer to
another date/datetime field. See [the content schema guide](../../docs/CONTENT_SCHEMA.md)
for complete field details and examples.

## Public exports

- `@areca-cms/site-sdk`: client, schema helpers and types, preview, SEO, and
  rich-text helpers.
- `@areca-cms/site-sdk/pull`: `pullContent()` and `readContent()`.
- `@areca-cms/site-sdk/seo`: SEO helpers and types.
- `@areca-cms/site-sdk/rich-text`: rich-text helpers.
