# Without React: Astro, SvelteKit, Vue, Express, Hono, plain Node

`@areca-cms/site-sdk/visual` has no React dependency. Every framework uses the same three parts:

1. The preview response sends `visualEditingHeaders({ cmsOrigin })` and `previewHeaders()`, and puts the CMS origin in the page for the browser script.
2. A browser script creates the bridge with `createVisualBridge`.
3. A POST endpoint renders each live result on the server with `content.previewFrom(result)` or `content.previewGlobals(result)`.

Pick one of two ways to show a live result:

- **Data re-render** for frameworks with client state (SvelteKit, Nuxt/Vue, Solid). The endpoint returns the preview data as JSON and the page's reactive state updates.
- **HTML swap** for server templates (Astro, Express or Hono with templates, plain Node). The page route renders itself again from the posted result, and the script swaps the new HTML into the page.

## The bridge API

```ts
import { createLatestResolver, createVisualBridge } from "@areca-cms/site-sdk/visual";

const bridge = createVisualBridge({
  cmsOrigin,                         // required: the exact CMS origin; a path is dropped
  onUpdate(result, info) { ... },    // required: called for each update newer than the last; info = { seq, locale }
  markers: true,                     // optional: false turns the click-to-edit overlay off
  // window: for tests only. With a custom window the overlay is never drawn.
});
bridge.connected(); // true once the CMS has sent a valid message
bridge.destroy();   // removes listeners and the overlay; safe to call twice
```

- Outside an iframe it returns an inert handle and does nothing, so the script can run on every page. It still throws `Not a CMS URL: …` for a malformed `cmsOrigin`, so only start it with a checked origin.
- `onUpdate` is synchronous from the bridge's point of view. If it starts a request, a slower old request can finish after a newer one. Apply results with `createLatestResolver(apply)`: `accept(seq, value)` ignores any `seq` at or below the last applied one.
- Call `destroy()` when the page goes away (`pagehide`, a component's unmount, a client-side route change).
- Only one bridge per page.

## HTML swap (Astro, Express, Hono, plain Node)

### Browser script

The preview page renders its content inside one root element, with the CMS origin on it:

```html
<main data-preview-root data-cms-origin="https://cms.example.com"> ...the page... </main>
```

```ts
// src/scripts/visual-preview.ts (bundled for the browser)
import { createLatestResolver, createVisualBridge } from "@areca-cms/site-sdk/visual";

const root = document.querySelector<HTMLElement>("[data-preview-root]");
const cmsOrigin = root?.dataset.cmsOrigin;

if (root && cmsOrigin) {
  const latest = createLatestResolver<string>((html) => {
    root.innerHTML = html; // the overlay notices the new markers by itself
  });
  const bridge = createVisualBridge({
    cmsOrigin,
    onUpdate(result, info) {
      fetch(location.pathname + location.search, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(result),
      })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
        .then(({ html }: { html: string }) => latest.accept(info.seq, html))
        .catch((error) => console.warn(`Live preview: update ${info.seq} failed. Keeping the last good value.`, error));
    },
  });
  addEventListener("pagehide", () => bridge.destroy());
}
```

- Put `data-cms-origin` on the root **only** on preview responses. Public pages have no attribute, so the script does nothing.
- Scripts inside the swapped HTML do not run. Interactive widgets inside the root lose their state on each update. Keep the root to the content, or re-initialise widgets after the swap.

### Server: one route answers GET and POST

The same route renders the draft from the token (GET) and the unsaved values (POST with a JSON body). The POST answer is JSON with the root's HTML, never a bare HTML page, and it accepts only `Content-Type: application/json`. A cross-site form cannot send that type, so nobody can make a visitor's browser render posted values as a page on the site's origin.

Astro (SSR on this page: `output: "server"`, or an adapter with `export const prerender = false`; ask before changing the output mode):

```astro
---
// src/pages/__preview/[collection]/[slug].astro
export const prerender = false;
import { previewHeaders } from "@areca-cms/site-sdk";
import { visualEditingHeaders } from "@areca-cms/site-sdk/visual";
import { content } from "../../../generated/content/areca.gen";
import { cmsOriginFrom } from "../../../lib/cms-origin";
import EntryBody from "../../../components/EntryBody.astro";

// process.env, not import.meta.env: Astro inlines import.meta.env values at build time.
const cmsOrigin = cmsOriginFrom(process.env.ARECA_CMS_URL);
for (const [key, value] of Object.entries(previewHeaders())) Astro.response.headers.set(key, value);
if (cmsOrigin) {
  for (const [key, value] of Object.entries(visualEditingHeaders({ cmsOrigin }))) Astro.response.headers.set(key, value);
}

const isLive =
  Astro.request.method === "POST" &&
  (Astro.request.headers.get("content-type") ?? "").startsWith("application/json");

let preview;
try {
  preview = isLive
    ? content.previewFrom(validateLiveEntry(await Astro.request.json())) // your shape check; throws on bad input
    : await content.preview(Astro.url.searchParams.get("token") ?? "");
} catch {
  return new Response(isLive ? '{"error":"bad request"}' : "Preview unavailable", { status: isLive ? 400 : 401 });
}

if (isLive) {
  const html = await renderEntryBodyToString(preview); // see the note below
  return new Response(JSON.stringify({ html }), {
    headers: { "Content-Type": "application/json", ...previewHeaders() },
  });
}
---
<html lang="en">
  <head><meta name="robots" content="noindex, nofollow" /></head>
  <body>
    <main data-preview-root data-cms-origin={cmsOrigin ?? undefined}>
      <EntryBody preview={preview} markers />
    </main>
    <script src="../../../scripts/visual-preview.ts"></script>
  </body>
</html>
```

Rendering just the root to a string depends on the framework:

- Express, Hono or plain Node with a template function (`renderEntry(preview)` returning a string): call the same function for GET (inside the full layout) and POST (alone).
- Astro: a component cannot be rendered to a string from an endpoint without the experimental container API. The simplest route is to render the whole page for POST as well, then have the script parse it and take the root: `new DOMParser().parseFromString(html, "text/html").querySelector("[data-preview-root]")!.innerHTML`. Still wrap it in JSON (`{ html }`) for the reason above. If you can't return JSON from the page, put the live render on a separate `/__preview/live` endpoint that checks the content type the same way.

Express or Hono, in short:

```ts
app.get("/__preview/:collection/:slug", async (req, res) => {
  const cmsOrigin = cmsOriginFrom(process.env.ARECA_CMS_URL);
  res.set({ ...previewHeaders(), ...(cmsOrigin ? visualEditingHeaders({ cmsOrigin }) : {}) });
  const preview = await content.preview(String(req.query.token ?? "")); // catch: 401 expired, 404 gone
  res.send(layout(renderEntry(preview, { markers: true }), { cmsOrigin }));
});

app.post("/__preview/:collection/:slug", express.json({ limit: "2mb" }), (req, res) => {
  if (!req.is("application/json")) return res.status(415).end();
  res.set(previewHeaders());
  try {
    const preview = content.previewFrom(validateLiveEntry(req.body));
    res.json({ html: renderEntry(preview, { markers: true }) });
  } catch {
    res.status(400).json({ error: "bad request" });
  }
});
```

Site content pages use the same pattern on their `previewPath` route: GET with `?arecaPreview=` renders `content.previewGlobals(token)`, POST renders `await content.previewGlobals(result)`. Only send the frame header, the `data-cms-origin` attribute and the markers when the token is present, and keep the draft only when `previewing` is the page's section. Answer POST for that path only from a request with a JSON body.

## Data re-render (SvelteKit, Nuxt/Vue, Solid)

The page keeps the preview in reactive state, created from the loader's data. A JSON endpoint renders each live result.

SvelteKit:

```ts
// src/routes/__preview/[collection]/[slug]/+page.server.ts
import { error } from "@sveltejs/kit";
import { previewHeaders } from "@areca-cms/site-sdk";
import { visualEditingHeaders } from "@areca-cms/site-sdk/visual";
import { content } from "$lib/generated/content/areca.gen";
import { cmsOriginFrom } from "$lib/server/cms-origin";

export const prerender = false;

export async function load({ url, setHeaders }) {
  const cmsOrigin = cmsOriginFrom(process.env.ARECA_CMS_URL);
  setHeaders({ ...previewHeaders(), ...(cmsOrigin ? visualEditingHeaders({ cmsOrigin }) : {}) });
  try {
    return { preview: await content.preview(url.searchParams.get("token") ?? ""), cmsOrigin };
  } catch {
    error(401, "This preview link has expired. Open it again from the CMS.");
  }
}
```

```ts
// src/routes/__preview/live/+server.ts
import { json } from "@sveltejs/kit";
import { previewHeaders } from "@areca-cms/site-sdk";
import { content } from "$lib/generated/content/areca.gen";

export async function POST({ request }) {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return new Response(null, { status: 415 });
  try {
    return json(content.previewFrom(validateLiveEntry(await request.json())), { headers: previewHeaders() });
  } catch {
    return json({ error: "bad request" }, { status: 400 });
  }
}
```

```svelte
<!-- src/routes/__preview/[collection]/[slug]/+page.svelte -->
<script lang="ts">
  import { onMount } from "svelte";
  import { createLatestResolver, createVisualBridge } from "@areca-cms/site-sdk/visual";
  let { data } = $props();
  let preview = $state(data.preview);

  onMount(() => {
    if (!data.cmsOrigin) return;
    const latest = createLatestResolver((value: typeof data.preview) => (preview = value));
    const bridge = createVisualBridge({
      cmsOrigin: data.cmsOrigin,
      onUpdate(result, info) {
        fetch("/__preview/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((value) => latest.accept(info.seq, value))
          .catch((e) => console.warn(`Live preview: update ${info.seq} failed.`, e));
      },
    });
    return () => bridge.destroy();
  });
</script>

{#if preview.complete}
  <EntryView entry={preview.entry} markers />
{:else}
  <IncompleteDraft issues={preview.issues} />
{/if}
```

- If the project configures `kit.csp`, SvelteKit sends its own policy. Add `frame-ancestors` to that configuration in a way that applies to preview responses only, or ask the user, rather than sending two policies.
- Nuxt/Vue and Solid follow the same shape: state from the server data, the bridge in `onMounted`/`onMount`, `destroy()` on unmount, a POST endpoint that returns `content.previewFrom(...)` as JSON.
- Svelte, Vue and Solid spread attributes too: `<h1 {...field("title")}>` in Svelte, `v-bind="field('title')"` in Vue, `{...field("title")}` in Solid. Return `{}` instead of calling `field()` on public pages.

## Static sites

A site that only builds static HTML has no server, so `/__preview/*` returns 404 once deployed, and the visual editor stays unavailable. Keep the public pages static and add server code for the preview only: a Worker or function for `/__preview/*`, `GET /api/preview` and `POST /api/preview/live`. The full recipe, with Cloudflare Workers and TanStack Start code, the console errors to expect and the deploy settings, is in [static-sites.md](static-sites.md).

On Astro that is an adapter with `export const prerender = false` on those routes. Ask the user before changing how the site is built or hosted.
