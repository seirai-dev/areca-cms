# Preview, Go-live builds and errors

## CMS settings the site needs (asked of an owner or agency admin)

- **Production URL** (site settings). This enables preview links: the CMS opens `<productionUrl>/__preview/<collection>/<slug>?token=<signed>`.
- **Publishing mode**: `Demo` skips deploy and health checks, which is good for trying things out. `Production` needs a deployment target (Dokploy) and a **health check URL**.
- **Site key and tokens**: Settings > Developer. Rotating a token invalidates the old one immediately.

## Draft preview route

Server-side only. The preview token is signed, valid for about 1 hour, and separate from the site token. Never log, cache or store it.

```ts
import { getPreviewEntry, previewHeaders } from "@areca-cms/site-sdk";

// route: /__preview/$collection/$slug  (read ?token= from the URL)
try {
  const { collection, slug, entry } = await getPreviewEntry({ token });
  // render `entry` (same shape as SnapshotEntry) with the normal template
  // (with the generated content object, `content.preview(token)` returns the typed entry)
  // and set every header from previewHeaders() plus <meta name="robots" content="noindex">
} catch (error) {
  // Plain Error, no status field. The message holds the status:
  // "Failed to fetch preview (401): …" => link expired or invalid, ask for a new one
  // "(404)" => the entry no longer exists
}
```

A site content section preview is different. The CMS opens the section's `previewPath` on the site (for example `/about`) with `?arecaPreview=<token>`, not `/__preview`. `getPreviewEntry` returns `{ kind: "global", global, entry }` for that token. Read the token on the page, then call `content.previewGlobals(token)` (or pass the `PreviewGlobalResult`). It returns `{ globals, previewing, complete, issues }`: `globals` has the section replaced by its draft when the draft is complete, and the published section otherwise. Use the draft only when `previewing` is this page's section, and show a note when `complete` is `false`. An expired or mistyped token makes the fetch throw, so catch it and serve the published values. Set `previewHeaders()` on the response as for entries.

`getPreviewEntry` needs `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` at runtime. Exclude `/__preview` from prerendering and CDN caching. In TanStack Start, wrap the fetch in a `createServerFn` handler.

## Health route (Production mode)

Go live waits until the deployed site reports the publication it was built from:

```ts
// GET /api/health -> { ok: true, publicationId } or 503
import { readContentManifest } from "@areca-cms/site-sdk/pull";

export function health() {
  try {
    const { publicationId } = readContentManifest("src/generated/content");
    if (!publicationId) throw new Error("missing");
    return Response.json({ ok: true, publicationId });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
```

Set the CMS health check URL to this route, e.g. `https://www.example.com/api/health`.

## Builds (Docker / CI)

- Pull **before** the build: `"prebuild": "areca pull"` or an explicit step.
- The CMS deploy passes the build arg `ARECA_SNAPSHOT_ID`, and `areca pull` fetches exactly that publication. Declare the arg right before the pull step so the cache is busted for each release.
- Pass `ARECA_SITE_TOKEN` as a build secret, not as an ARG or ENV in the image.
- Copy `src/generated` into the runtime image when the server reads content at runtime.
- Media lands in `public/areca` before the build, so the framework bundles it with other static files. With a custom `assets.dir`, make sure the build or image includes it.

```dockerfile
ARG ARECA_CMS_URL
ARG ARECA_SNAPSHOT_ID
RUN --mount=type=secret,id=ARECA_SITE_TOKEN,required=true \
    ARECA_SITE_TOKEN="$(cat /run/secrets/ARECA_SITE_TOKEN)" pnpm build   # build runs areca pull via prebuild
# runtime stage:
COPY --from=build /app/src/generated ./src/generated
```

## Client and errors

```ts
import { createArecaClient } from "@areca-cms/site-sdk";
import { pullContent } from "@areca-cms/site-sdk/pull";

const client = createArecaClient({ cmsUrl, siteToken }); // or env vars
await pullContent({ outDir: "src/generated/content", client });
```

| Error | Fix |
| --- | --- |
| `Missing ARECA_CMS_URL` / `ARECA_SITE_TOKEN` | Set them in env or `.env.local` (CLI) |
| Missing `ARECA_SCHEMA_TOKEN` on push | Add it to the authoring env only |
| `401` | Wrong or rotated token, or the wrong token type (schema vs site) |
| `404` / no publication on pull | Nothing is live yet. Go live in the CMS, then pull again. |
| `429` | 300 requests/min per token. Wait for `Retry-After`. |
| `400` / `413` on push | Invalid schema, or the manifest is over 256 KiB |
| `Removing <key.field> deletes content` / `FieldDropsRequiredError` | Nothing was pushed. Ask the user before confirming, then re-run with `--confirm-drop <key.field>` (or `--yes`), or pass `confirmDropFields` to `syncManifest`. |
| `No content file for collection` | Run `areca pull`, then check the collection key |
| `Unsafe collection or field identifier` | Rename the key to match `^[A-Za-z][A-Za-z0-9_-]{0,63}$` |
| `Collection key "<key>" is reserved` / `resolve`, `href`, `preview`, `globals`, `previewGlobals` | Collections cannot use these names, because the content object uses them. Rename the collection. Field keys may keep them. |
| `Collection keys ... both map to` / `Field keys ... both map to` | Two keys have the same camelCase name, such as `blog-posts` and `blog_posts`. Rename one. |
| `Publication does not match its schema` | An entry breaks its schema. Each line names the entry, field and problem. Fix the entry or the schema, publish, and pull again. Nothing is written. |
| `Warning: Publication <id> has no embedded schema` | An older publication. Types use the current schema. Go live again to embed it. |
| `Expected publication X, received Y` | Pinned pull mismatch. Check `ARECA_SNAPSHOT_ID`. |
| TS config import fails | Use Node 24, or run through `tsx` |
