# Static sites (Cloudflare and other static hosts)

A draft preview needs code that runs on each request: the page reads a new token every time, and the visual editor sends unsaved values to be rendered. A site deployed as plain static files has no such code, so the preview breaks even when it works with `pnpm dev`.

Check this before building a preview route. Ask the user how the site is hosted if you can't tell from the repo. Signs of a static deployment:

- `wrangler.jsonc` / `wrangler.toml` with `assets.directory` and no `main`.
- A Cloudflare Pages project, Netlify, GitHub Pages, S3 or any host that serves only `dist/`.
- TanStack Start with `prerender.enabled` and no server output deployed. Astro with the default `output: "static"` and no adapter. Next.js with `output: "export"`.

## What it looks like

The editor opens Visual mode or **Preview** and gets the site's 404 page, a blank frame, or "Preview unavailable". In the browser console of the CMS tab:

| Console line | What it means |
| --- | --- |
| `GET <site>/__preview/<collection>/<slug>?token=…` → `404` | No page exists for that path in the static files. **This is the cause.** |
| `GET <site>/_serverFn/<hash>?payload=…` → `404` (TanStack Start) | The route's `createServerFn` loader has no server to run on. Same cause. |
| `Minified React error #418` | Hydration mismatch: the browser tried to hydrate the 404 page as the preview route. A result of the 404s, not a separate bug. |
| `Cross-Origin Request Blocked … static.cloudflareinsights.com/beacon.min.js` and `None of the "sha512" hashes in the integrity attribute match` | Cloudflare Web Analytics, injected by Cloudflare, blocked inside the CMS frame. Noise. The user can turn it off under Web Analytics in the Cloudflare dashboard. |
| `[tiptap warn]: prosemirror-model is loaded more than once` | Comes from the CMS editor bundle, not the site. Doesn't affect the preview. |
| `Partitioned cookie or storage access was provided to …` | Browser notice for any page in a third-party frame. Noise. |

It isn't a CORS problem and it isn't a CMS bug. Don't change CORS settings or the CMS to fix it.

## The fix: keep the pages static, add server code for the preview only

Don't convert the whole site to a server just for previews. Ask the user before changing how the site is built or hosted. The recommended shape keeps every public page as a prerendered file and adds a small handler for three paths:

| Path | Serves |
| --- | --- |
| `/__preview/*` | A client-rendered page shell, with `previewHeaders()` and `visualEditingHeaders({ cmsOrigin })`. |
| `GET /api/preview?token=…&locale=…` | The saved draft: `content.preview(token, { locale })` as JSON, plus `cmsOrigin`. |
| `POST /api/preview/live` | Unsaved values from the visual editor: `content.previewFrom(body)` as JSON. |

Every other request goes to the static files unchanged. The preview page loads its data from `/api/preview` in the browser, so it no longer needs a server function. The preview call needs only `ARECA_CMS_URL`: the CMS authorises it with the signed token, so the handler doesn't need the site token.

Write the API as one plain `(request: Request) => Promise<Response | null>` function, so the same code runs in the Worker and in a dev server middleware.

### Cloudflare Workers (static assets + a Worker)

`wrangler.jsonc`:

```jsonc
{
  "name": "my-site",
  "compatibility_date": "2026-11-01",
  // process.env.ARECA_CMS_URL for the SDK, read from "vars" below
  "compatibility_flags": ["nodejs_compat"],
  "main": "src/worker.ts",
  "assets": {
    "directory": "./dist/client",
    "binding": "ASSETS",
    "not_found_handling": "404-page",
    // Only these paths run the Worker. Everything else is served from assets.
    "run_worker_first": ["/__preview/*", "/api/preview", "/api/preview/*"]
  },
  "vars": {
    // Public CMS origin: drafts are read from it, and only it may frame the preview
    "ARECA_CMS_URL": "https://cms.example.com"
  }
}
```

`src/worker.ts`:

```ts
import { handlePreviewApi, previewPageHeaders, cmsOriginFrom } from "./lib/preview/api";

interface Env {
  ASSETS: { fetch: (request: Request | string) => Promise<Response> };
  ARECA_CMS_URL?: string;
}

const SHELL_PATH = "/__preview/shell"; // written by the build, see below

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const api = await handlePreviewApi(request, env.ARECA_CMS_URL);
    if (api) return api;

    const url = new URL(request.url);
    if (url.pathname.startsWith("/__preview/")) {
      const shell = await env.ASSETS.fetch(new URL(SHELL_PATH, url).toString());
      const headers = new Headers(shell.headers);
      for (const [name, value] of Object.entries(previewPageHeaders(cmsOriginFrom(env.ARECA_CMS_URL)))) {
        headers.set(name, value);
      }
      return new Response(shell.body, { status: shell.status, headers });
    }
    return env.ASSETS.fetch(request);
  },
};
```

`previewPageHeaders(cmsOrigin)` returns `X-Robots-Tag` and `Cache-Control` from `previewHeaders()`, plus the `Content-Security-Policy` from `visualEditingHeaders({ cmsOrigin })` when the origin is known. Every JSON response from the API sends the same `X-Robots-Tag` and `Cache-Control`.

Add `wrangler` as a dev dependency. With pnpm, allow `workerd`'s install script (`allowBuilds: { workerd: true }` in `pnpm-workspace.yaml`, or `onlyBuiltDependencies`).

### TanStack Start: the client-rendered shell

Keep `prerender` as it is, and add the `spa` option so the build also writes a shell that renders in the browser:

```ts
tanstackStart({
  prerender: { enabled: true, filter: (page) => !page.path.startsWith("/__preview") && !page.path.startsWith("/api") },
  spa: {
    enabled: true,
    maskPath: "/__preview/shell/shell",
    prerender: { outputPath: "/__preview/shell" },
  },
});
```

On the route, set `ssr: false` and load from the API instead of a `createServerFn`:

```tsx
export const Route = createFileRoute("/__preview/$collection/$slug")({
  ssr: false,
  validateSearch: (search) => searchSchema.parse(search),
  loaderDeps: ({ search }) => ({ token: search.token, locale: search.locale }),
  loader: ({ deps }) => fetchPreview(deps.token, deps.locale), // fetch(`/api/preview?token=…`)
  component: PreviewPage,
});
```

In `useLivePreview`, `resolve` POSTs the result to `/api/preview/live` and returns the JSON. Everything else in [react.md](react.md) stays the same.

For `pnpm dev`, serve the same API with a Vite plugin (`apply: "serve"`, `enforce: "pre"`) whose middleware passes `/api/preview*` requests to `handlePreviewApi` through `server.ssrLoadModule`. Build output is unaffected.

### Other frameworks and hosts

The shape is the same everywhere: static pages, one route or function for `/__preview/*`, and the two API paths.

- Astro: an adapter with `export const prerender = false` on the preview routes only.
- Netlify or Vercel: a function or edge function for the three paths, with the rest served statically.
- Cloudflare Pages (not Workers): Pages Functions for the same three paths.

## Things that don't work

- **The whole site on `@cloudflare/vite-plugin`.** Prerendering then runs inside workerd, which can't read the content that `areca pull` wrote to disk, so pages that read content fail to prerender. Keep the normal build and add the Worker beside it.
- **Fetching the draft straight from the CMS in the browser.** The CMS preview API sends no CORS headers. The request must go through the site's own handler.
- **Prerendering `/__preview`.** It would write one draft to disk for anyone to read, and the next token would still 404.

A Worker has no project files. `content.preview(token)` and `content.previewFrom(result)` call the CMS and convert the result, which works in the Worker. If the preview page also shows data read from the pulled files (referenced entries, site content, lists), test it with `wrangler dev` before relying on it.

## Deploying it

- **Areca's Cloudflare adapter** starts a Workers Builds build, which runs the repo's build and then the project's deploy command. The deploy command in the Worker's **Settings › Builds** must be plain `npx wrangler deploy`, so `main` and `run_worker_first` from `wrangler.jsonc` are deployed. An assets-only command (`wrangler deploy --assets …` or a Pages upload) deploys the files without the Worker, and the preview 404s again.
- `ARECA_CMS_URL` must reach the **runtime**: put it in `vars` (it is public) or in the Worker's runtime variables. The build variables that `areca pull` uses are not visible to the Worker at request time.
- The CMS **Preview URL** (or the Production URL) must be the `https://` address the Worker answers on.

## Check it

```bash
curl -sI "<preview url from the CMS>" | grep -i -E "^HTTP|content-security-policy|cache-control|x-robots-tag"
# expect 200, frame-ancestors 'self' https://<cms host>, no-store, noindex
curl -s "<site>/api/preview?token=<token from that url>" | head -c 300
# expect JSON with the draft, not the 404 page
```

Locally: `pnpm build && npx wrangler dev`, then open a preview link from the CMS with its host replaced by the `wrangler dev` address.
