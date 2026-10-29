# `@areca-cms/site-sdk`

Connect a Node.js website to an existing Areca CMS site. The SDK publishes the
site's content schema, downloads the current published snapshot, and fetches
draft entries for preview. It does not create a CMS site or generate frontend
routes.

For a step-by-step integration guide, see the repository's
[SDK guide](../../docs/SDK.md). Using an AI coding agent? Run
`npx @areca-cms/skills` to teach it this SDK and the Areca MCP server.

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

The default output is `src/generated/content/`. The pull also writes
`areca.gen.ts` there, which exports a typed `content` object for reading the
snapshot from a server loader or build script. Commit that file. Do not import
the site token or call the CMS from a public browser bundle.

## CLI

| Command                                               | Purpose                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `areca init`                                          | Create frontend config and environment-file scaffolding.                                                |
| `areca pull [--out <directory>] [--publication <id>] [--config <path>] [--types <path>]` | Download the current published snapshot and its media, and write `areca.gen.ts`; default output is `src/generated/content`. |
| `areca manifest push [config] [--confirm-drop <collection.field>]... [--yes]` | Send the local config to the CMS. Default config is `./areca.config.ts`. Requires `ARECA_SCHEMA_TOKEN`. Removing a field that holds content needs confirmation. |
| `areca manifest pull [--config <path>] [--yes]`       | Replace the local config with enabled CMS collections. Removals (collections, sections, fields, languages, main language) need confirmation. |
| `areca sync-manifest [config]`                        | Deprecated alias for `areca manifest push`.                                                             |
| `areca run -- <command>`                              | Run a child command with SDK-loaded environment files.                                                  |

`areca init` accepts `--cms-url`, `--token`, `--site-key`, `--out`, `--config`,
`--assets-dir`, `--assets-public-path`, `--no-assets`, `--yes`/`-y`, and
`--force`. Use flags with `--yes` in automation. `--force` allows init to
overwrite its config and `.env.example` outputs. Interactively, init asks
whether to download media into the repo (default yes) and where (default
`public/areca`). Run on an existing config, it adds an `assets` block, or asks
before replacing one.

`manifest pull` replaces the entire config file, including comments and helper
code. It prints a diff. It asks only when something would be removed, and in
non-interactive use `--yes` is required then. Additions and changes are written
without a prompt, and a file that already matches the CMS is left alone. The local `siteKey` and `assets`
settings are kept. If there is no config, set `ARECA_SITE_KEY` or run
`areca init` first.

`areca pull` exits with an error if the site has no published snapshot. Publish
content in the CMS before adding it to a production build. Pulls write an immutable generation, then atomically replace `manifest.json` to select it:

```text
src/generated/content/
├── areca.gen.ts        # types and the content object (commit this)
├── manifest.json       # publication ID, hash, counts, and generation pointer
└── .publications/
    └── publication-<generation>/
        ├── blogPosts.json  # one file per collection, named by its camelCase key
        └── .assets.json    # media files this generation uses
public/areca/
└── hero-banner-3f2a91c0.jpg
```

Use the `content` object, or `readContent()`, instead of importing a flat `<collection>.json` file. It follows
the current manifest and rejects collections absent from that publication. Legacy
flat outputs remain readable. A failed pull preserves the complete prior generation.
The current generation and the two before it are kept for readers that captured
their manifest; older ones are deleted with the media files only they used.
Direct file imports do not receive this atomic-switch guarantee.

### Media

By default `areca pull` copies every file the content references (image fields,
SEO images, rich-text images and file links) into `public/areca` and rewrites the
content to `/areca/<name>-<id>.<ext>`, so the site never requests anything from
the CMS. SEO image URLs (`og:image`, `twitter:image`, JSON-LD) become absolute
using the site's production URL from the CMS. Configure it in `areca.config.ts`:

```ts
export default defineSiteContent({
  siteKey: 'acme-site',
  assets: {
    download: true, // false keeps CMS URLs
    dir: 'public/areca', // relative to the project root
    // publicPath: '/areca', // required when dir is not under public/
  },
  collections: {},
})
```

Files are downloaded from `ARECA_CMS_URL` once and skipped on later pulls. A
failed download fails the pull and leaves the previous content unchanged.
`manifest push` never sends `assets` to the CMS.

`areca pull` honors `ARECA_SNAPSHOT_ID` from deployment builds, or an explicit
`--publication <id>`. Empty and `0` values select the current live/demo publication.
The SDK checks that the CMS returned the requested publication before writing.

The generated files should usually be ignored by Git and created during local
development or the build. Pull rejects unsafe collection names and refuses
symbolic-link output files.

## Read typed content

`areca pull` also writes `src/generated/content/areca.gen.ts`. It is generated
from the schema of the published content, and it exports a typed `content`
object. Commit it. The pulled JSON stays out of Git.

```ts
import { content } from "../generated/content/areca.gen";

export const articles = content.articles.all({ limit: 10 });
export const article = content.articles.get("hello-world"); // undefined if unknown
```

Each collection has `all`, `first`, `get`, `byId` and `href`. `all` and `first`
accept `where` (equality, and operators that fit each field type), `orderBy`,
`limit`, `offset` and `with` (one level of references). `content.resolve(ref)`
follows a reference, and `content.href(...)` builds the route. Use `content.preview(token)`
for draft previews. It returns `complete: true` with an `Entry`, or `complete: false` with a
`DraftEntry` and a list of `issues`. The module reads the folder you pulled into, or
`ARECA_CONTENT_DIR` when it is set.

Collection and field names are camelCase in code: `blog-posts` is
`content.blogPosts`, and `cover_image` is `entry.data.coverImage`. The config keeps
the raw keys. The pull fails on keys that collide after this conversion, and
`resolve`, `href`, `preview`, `globals` and `previewGlobals` cannot be collection keys.

Each entry has `id`, `slug`, `publishedAt`, `collection`, `data` and optional
`seo`. Optional fields can be `null`, missing or `""`, and the types show each
case. The pull checks every entry against the schema before it writes anything.

For low-level access, `readContent(directory, "blogPosts")` from
`@areca-cms/site-sdk/pull` returns the typed entries of one collection. Capture
`readContentManifest(directory)` once and pass it as the third argument to read
several collections from one publication.

`readContent()` reads files at runtime, so the generated directory must ship with
the server build or container, including `.publications/`. Use the content object
from server code only, never from a browser bundle.

## Site content (globals)

Site content sections hold single-instance copy that is not a list of entries:
company details, home-page text, stats. The CMS defines them (or
`areca.config.ts` does, under `globals`), and `areca pull` writes them next to
the collections.

```ts
import { content } from "../generated/content/areca.gen";

const info = content.globals.companyInfo;
info.email; // string: required fields are never null
info.phoneNumber; // string | null | undefined, like any optional field
content.globals.homePage.$seo; // only on sections with seo: true
```

Each section is typed like an entry's `data` with no `slug`. Field keys are
camelCase, and `$seo` is added when the section has SEO on. `group` on a field
only changes the CMS editor layout, so it does not appear in the SDK value.
`await content.previewGlobals(source)` returns a `GlobalsPreview` (exported
from the package root):

```ts
type GlobalsPreview<G> = {
  globals: Globals<G>; // always typed; the published section when the draft is incomplete
  previewing: GlobalKey<G> | null; // camel key of the section the token targets
  complete: boolean; // false when the draft failed validation
  issues: string[]; // "<field>: <problem>" with camel keys, empty when complete
};
```

`source` is a site content preview token, or a preview result from
`getPreviewEntry(...)` (no request is made then). A valid draft is overlaid on
its section. An incomplete draft (a required field empty, a wrong type, an image
or reference that does not match) keeps the published section, so typed access
such as `.image.url` never reads a null. A falsy token or an entry preview
returns the published values with `previewing: null` and `complete: true`.

```ts
const preview = await content.previewGlobals(token);
if (preview.previewing === "homePage" && !preview.complete) {
  // show "incomplete draft, showing the live version" with preview.issues
}
const home = preview.globals.homePage;
```

```ts
export const config = defineSiteContent({
  siteKey: "demo",
  collections: { /* ... */ },
  globals: {
    companyInfo: {
      label: "Company info",
      fields: [
        { key: "email", label: "Email", type: "text", required: true, group: "Contact" },
      ],
    },
    homePage: { label: "Home page", seo: true, previewPath: "/", fields: [/* ... */] },
  },
});
```

Sections cannot use `slug` fields. References in a section can point to
collections, but collections cannot point to a section.

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

## Visual editing (live preview)

The CMS visual editor shows the site's preview route in an iframe and sends it
unsaved changes as you type. The site needs two things.

1. **Let the CMS frame the preview route.** Send `visualEditingHeaders` on that
   route only, next to `previewHeaders()`:

   ```ts
   import { visualEditingHeaders } from "@areca-cms/site-sdk/visual";

   const headers = visualEditingHeaders({ cmsOrigin: "https://cms.example.com" });
   // Add to the preview response: { ...previewHeaders(), ...headers }
   ```

2. **Render the live values.** `useLivePreview` shows `initial` until the CMS sends
   an update, then the value `resolve` returns. Content is read from files on the
   server, so `resolve` calls a server function that runs `content.previewFrom(result)`:

   ```tsx
   import { useLivePreview } from "@areca-cms/site-sdk/visual-react";

   const post = useLivePreview({
     initial: entry, // from the loader; keep it stable
     cmsOrigin: "https://cms.example.com",
     resolve: async (result) => (await previewPost(result)).entry,
   });
   ```

   `previewPost` is your server function: it calls `content.previewFrom(result)` and
   returns the result. `previewFrom` validates and camelises the same way
   `content.preview()` does, without a request.

The bridge only talks to the CMS origin. It replies to that origin alone and
ignores messages from any other origin or window. Outside an iframe it does nothing,
so a published page is unaffected.

### Click to edit

Mark the elements that show a field, and the visual editor outlines them. Clicking
one jumps to that field in the editor.

```tsx
import { field } from "@areca-cms/site-sdk/visual";

<h1 {...field("title")}>{article.title}</h1>
<p {...field("$seo.description")}>{article.seo.description}</p>
<p {...field("email", { global: "company" })}>{company.email}</p>
<span {...field("name", { entry: author.id })}>{author.name}</span>
```

- `field(key)` marks a field of the page's own entry. Use the key as your code
  sees it (camelCase), or `$seo.<key>` for SEO fields.
- `{ global: key }` marks a field of a site content section, such as the header or
  footer. Those elements are outlined too, and a click explains where the field lives.
- `{ entry: id }` marks a field of another entry on the site, such as a referenced
  author. Only entries the editor can open are outlined.

The attributes do nothing outside the visual editor, so leave them on in production.

The visual editor has two modes for the preview. **Select** (the default) outlines
marked elements as you hover and jumps to the field on click. Links and forms don't
navigate in Select. **Browse** uses the page normally. Switch with the toolbar toggle,
or hold Option (Alt on Windows and Linux) for a moment.

The bridge reports each client-side navigation to the editor (through `popstate`,
`hashchange` and a short poll), so the editor can tell when the preview has left the
entry's page. Pass `markers: false` to `createVisualBridge` to turn the outlines and
click handling off and keep only the live updates.

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
`constructor`, `prototype`, `__proto__`, and Windows device names. Collection
keys cannot be `resolve`, `href`, `preview`, `globals` or `previewGlobals`, because the content
object uses those names. Site content keys follow the same rules. Field types
are `text`, `textarea`, `richtext`, `image`, `date`, `datetime`, `select`,
`reference`, `slug`, `boolean`, `number`, and `url`. `select` uses `options`,
`reference` uses `collection`, and date ordering can use `after` to refer to
another date/datetime field. See [the content schema guide](../../docs/CONTENT_SCHEMA.md)
for complete field details and examples.

## Public exports

- `@areca-cms/site-sdk`: client, schema helpers and types, preview, SEO, and
  rich-text helpers.
- `@areca-cms/site-sdk/pull`: `pullContent()`, `readContent()` and `readContentManifest()`.
- `@areca-cms/site-sdk/content`: `createContent()`, the typed content object (Node only).
- `@areca-cms/site-sdk/seo`: SEO helpers and types.
- `@areca-cms/site-sdk/visual`: the live preview bridge, `field` for click-to-edit markers, and `visualEditingHeaders` (browser-safe).
- `@areca-cms/site-sdk/visual-react`: `useLivePreview` for React sites.
- `@areca-cms/site-sdk/rich-text`: rich-text helpers.
