# Site SDK API

This page describes the HTTP contract used by `@areca-cms/site-sdk` and the
matching client methods. Most sites should use the SDK rather than call these
endpoints directly.

This page does not cover the MCP endpoints that AI apps use: the per-site connector URL (`/api/mcp/<site-slug>`, OAuth sign-in) and the personal-key endpoint (`/api/mcp`). They authenticate users, not site projects, so they never use site tokens. See [Connect AI (MCP)](MCP.md).

## Base URL and credentials

Set the CMS origin in `ARECA_CMS_URL`. The SDK removes trailing slashes and
uses these bearer tokens:

| Credential   | Header                                 | Access                                  |
| ------------ | -------------------------------------- | --------------------------------------- |
| Site token   | `Authorization: Bearer <site-token>`   | Read the manifest and current snapshot. |
| Schema token | `Authorization: Bearer <schema-token>` | POST schema manifest.                   |

`ARECA_SITE_TOKEN` and `ARECA_SCHEMA_TOKEN` are separate. The SDK requires
`ARECA_SITE_TOKEN` when `createArecaClient()` is constructed, including before
a schema push. The POST itself uses `ARECA_SCHEMA_TOKEN`; GET requests use the
site token. Never put either credential in browser code. Keep the schema token
in the local schema-authoring environment and out of build/deploy secrets.

## Endpoints

| Method and path                                | Authorization                  | Purpose                              | Success body                        |
| ---------------------------------------------- | ------------------------------ | ------------------------------------ | ----------------------------------- |
| `GET /api/sites/manifest`                      | Site token                     | Read the site's content schema       | `{ "collections": { ... } }`        |
| `POST /api/sites/manifest`                     | Schema token                   | Create or update the site's schema   | `{ "ok": true }`                    |
| `GET /api/sites/snapshot/current`              | Site token                     | Get the current publication snapshot | `Snapshot` object                   |
| `GET /api/sites/preview?token=<preview-token>` | Signed, expiring preview token | Get one draft entry                  | `{ "collection", "slug", "entry" }` |

The POST body is the manifest shape, with a `collections` object. The SDK
converts `areca.config.ts` to that body; collection labels are preserved when
provided. A snapshot contains `publicationId`, `siteKey`, `createdAt`, `hash`,
and a `collections` map of entry arrays. Preview requests are authorized by the signed,
expiring query token; the SDK also sends its standard site-token bearer header,
but the preview route validates the preview token itself. Preview requests
return a `PreviewResult` containing the collection key, slug, and entry.

Without a `publicationId` query parameter, the snapshot endpoint returns the
authenticated site's latest publication by creation time with status `live`,
or status `demo` when the site is in Demo mode. An active build does not change
this selection. If no publication matches the site's current mode, it returns 404.

`GET /api/sites/snapshot/current?publicationId=<id>` requests that exact frozen
publication from the authenticated site, regardless of its status, including
while it is building. An ID that does not exist or belongs to another site returns
404; the endpoint never falls back to the current publication. An empty or
whitespace-only `publicationId` query value returns 400. Snapshot responses,
including errors, use `Cache-Control: no-store`.

Use `client.fetchSnapshot({ publicationId })` to send this query. The SDK rejects
a response whose publication ID does not match the requested ID.
`fetchSnapshot()` does not read `ARECA_SNAPSHOT_ID` itself. `areca pull` and
`pullContent({ outDir, publicationId? })` select an explicit publication when
provided (`--publication <id>` for the CLI), otherwise they read
`ARECA_SNAPSHOT_ID`. An unset, empty, whitespace-only or `0` environment value
selects the current successful live/demo publication. Dokploy sets this Docker
build argument for each deployment to pin the pull and invalidate its cached
build layer. No publication ID header is used. See [the SDK guide](SDK.md).

Do not place the preview token in logs or analytics. The SDK sends it as the
preview URL's query parameter; handle the token only on the server, set
`Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`, and do not
cache the response.

## SDK client

```ts
import { createArecaClient } from "@areca-cms/site-sdk";
import type { SiteContentConfig } from "@areca-cms/site-sdk";

const client = createArecaClient();
const manifest = await client.fetchManifest();
const snapshot = await client.fetchSnapshot();
const config: SiteContentConfig = { siteKey: "acme-site", collections: {} };
await client.syncManifest(config);
const preview = await client.fetchPreview(previewToken);
```

Options can be passed instead of environment variables:

```ts
const client = createArecaClient({
  cmsUrl: "https://cms.example.com",
  siteToken: process.env.ARECA_SITE_TOKEN,
  schemaToken: process.env.ARECA_SCHEMA_TOKEN,
});
```

`syncManifest(config)` requires both tokens to construct the SDK client and
uses the schema token for the POST. `fetchManifest`, `fetchSnapshot`, and
`fetchPreview` include the site-token bearer header. Preview authorization is
determined by the separate opaque preview token passed to `fetchPreview()`.

The `@areca-cms/site-sdk/pull` subpath exports `pullContent({ outDir, client? })`
and `readContent<T>(outDir, collectionKey)`. `pullContent` fetches the current
snapshot and writes `manifest.json` plus one JSON array per collection. It
fails if no publication exists. `readContent` reads one collection array and
reports a helpful message if the file has not been generated yet.

## Errors and retries

The client throws an `Error` if required URL/token settings are missing, the
CMS cannot be reached, or the CMS responds unsuccessfully. HTTP errors include
the status code and the response's `error` message when the server provides
one. A missing current snapshot has a dedicated message telling the operator
to publish content first. The CLI prints the error and exits with status 1.

The SDK does not automatically retry requests. A build or deployment system
can rerun the whole content pull after correcting a transient network issue.
An authentication error usually means the wrong token was supplied or it was
rotated; update the secret from the CMS site settings. Schema publishing
authentication failures require the schema token, not the site token.

Site manifest and snapshot routes are limited to 300 requests per minute per
site token (or client IP when no token is supplied and trusted proxy IPs are
configured). A rate-limited response is
HTTP `429` with `{ "error": "Too many requests" }` and a `Retry-After` header
in seconds. The SDK reports the HTTP status and error body; it does not retry
automatically. Wait for the indicated interval before retrying.

Manifest uploads are limited to 256 KiB, 100 collections, and 100 fields per
collection. Select fields allow at most 200 options; collection routes are at
most 500 characters; labels are at most 200 characters; descriptions are at
most 1,000 characters; and option strings are at most 200 characters. Invalid
manifests return `400`; oversized bodies return `413`.

## Types and response data

The package root exports `ArecaClient`, `ArecaClientOptions`, `SiteManifest`,
`Snapshot`, `SnapshotEntry`, `PreviewResult`, `PulledContentManifest`, schema
types, and `ImageValue`, `RichTextValue`, `ReferenceValue`, and `SeoMeta`.
Collection field values are application-defined, so pair `SnapshotEntry` with
your own `data` type:

```ts
import type { RichTextValue, SnapshotEntry } from "@areca-cms/site-sdk";

type Article = SnapshotEntry & {
  data: { title: string; body: RichTextValue };
};
```

Rich text provides an escaped Markdown export, an editor-preserving TanStack Markdown AST, the original
JSON representation, and a static HTML fallback. Images include dimensions,
alt text, and MIME type. If present, `seo` contains resolved page metadata and
JSON-LD; older snapshots can omit it. See [Content schema](CONTENT_SCHEMA.md)
and [the SDK guide](SDK.md) for the full field and
rendering instructions.
