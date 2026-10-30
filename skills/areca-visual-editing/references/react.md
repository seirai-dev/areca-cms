# React: TanStack Start and Next.js

The reference implementation is the demo site: https://github.com/seirai-dev/areca-cms/tree/main/examples/demo-site (TanStack Start). Files: `src/lib/queries.ts`, `src/lib/page-data.server.ts`, `src/lib/visual-markers.tsx`, `src/routes/[__preview]/$collection/$slug.tsx`, `src/routes/__root.tsx`, `src/routes/index.tsx`, `src/routes/about.tsx`. Copy its patterns, not its copy.

## Shared helper: the CMS origin

Read `ARECA_CMS_URL` on the server at request time and turn it into an origin, or `null` when it is missing or invalid. `visualEditingHeaders` and `createVisualBridge` throw for a bad value, and `useLivePreview` passes an invalid string straight to the bridge, so never hand them an unchecked string.

```ts
// src/lib/cms-origin.ts (server)
export function cmsOriginFrom(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const origin = new URL(trimmed).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}
```

If the CMS editors use another CMS origin too (a local CMS in development), pass an array to `visualEditingHeaders`. The bridge takes one origin: the one that frames the page. Use the origin of `ARECA_CMS_URL` for it.

## TanStack Start

### Server functions

```ts
// src/lib/preview.server.ts
import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { previewHeaders, type PreviewResult } from "@areca-cms/site-sdk";
import { visualEditingHeaders } from "@areca-cms/site-sdk/visual";
import { z } from "zod";
import { content } from "../generated/content/areca.gen";
import { cmsOriginFrom } from "./cms-origin";

function setNoStoreHeaders() {
  const headers = previewHeaders();
  setResponseHeader("X-Robots-Tag", headers["X-Robots-Tag"]);
  setResponseHeader("Cache-Control", headers["Cache-Control"]);
}

/** Lets the CMS frame this response. Returns the CMS origin, or null when it is unknown. */
function frameForVisualEditing(): string | null {
  const cmsOrigin = cmsOriginFrom(process.env.ARECA_CMS_URL);
  if (cmsOrigin !== null) {
    const csp = visualEditingHeaders({ cmsOrigin });
    setResponseHeader("Content-Security-Policy", csp["Content-Security-Policy"]);
  }
  return cmsOrigin;
}

// First render: the saved draft from the signed token.
export const loadPreview = createServerFn({ method: "GET" })
  .validator(z.object({ token: z.string().min(1) }))
  .handler(async ({ data }) => {
    setNoStoreHeaders();
    const cmsOrigin = frameForVisualEditing();
    try {
      return { ok: true as const, preview: await content.preview(data.token), cmsOrigin };
    } catch (error) {
      // 401: expired or invalid link. 404: the entry is gone.
      return { ok: false as const, error: error instanceof Error ? error.message : "Failed to fetch preview", cmsOrigin };
    }
  });

const liveEntryInput = z.looseObject({
  kind: z.literal("entry").optional(),
  collection: z.string().min(1),
  slug: z.string().min(1),
  entry: z.looseObject({
    id: z.string(),
    slug: z.string(),
    publishedAt: z.string().nullable(),
    data: z.record(z.string(), z.unknown()),
  }),
});

// Live renders: the unsaved values the bridge received. Nothing is saved.
export const loadLivePreview = createServerFn({ method: "POST" })
  .validator((input: unknown) => liveEntryInput.parse(input))
  .handler(({ data }) => {
    setNoStoreHeaders();
    try {
      return { ok: true as const, preview: content.previewFrom(data as PreviewResult) };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Failed to render preview" };
    }
  });
```

- `setResponseHeader` in the loader's server function lands on the document response, because the CMS loads the iframe with a full page request. That is the response the browser checks for `frame-ancestors`.
- The live function returns data without `cmsOrigin`; `resolve` adds it back (below), so the hook's value keeps the same shape.
- If TypeScript rejects the return type as not serializable, the demo passes `{ strict: { output: false } }` in the `createServerFn` options.

### Preview route

Name the folder `[__preview]` so the router keeps the `__preview` path.

```tsx
// src/routes/[__preview]/$collection/$slug.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useLivePreview } from "@areca-cms/site-sdk/visual-react";
import { z } from "zod";
import { loadLivePreview, loadPreview } from "../../../lib/preview.server";

export const Route = createFileRoute("/__preview/$collection/$slug")({
  validateSearch: (search) => z.object({ token: z.string().min(1) }).parse(search),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: ({ deps }) => loadPreview({ data: { token: deps.token } }),
  head: () => ({ meta: [{ title: "Preview" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: PreviewPage,
});

function PreviewPage() {
  const { collection } = Route.useParams();
  const loaded = Route.useLoaderData();
  // The saved draft until the visual editor sends unsaved values, then those.
  const result = useLivePreview({
    initial: loaded,
    cmsOrigin: loaded.cmsOrigin,
    resolve: async (preview) => ({ ...(await loadLivePreview({ data: preview })), cmsOrigin: loaded.cmsOrigin }),
  });

  if (!result.ok) return <p>Preview unavailable: {result.error}</p>;
  const { preview } = result;
  if (preview.collection !== collection) return <p>This link is for another collection.</p>;
  if (!preview.complete) return <IncompleteDraft issues={preview.issues} />;

  switch (preview.collection) {
    case "articles":
      return <ArticleView article={preview.entry} preview />;
    // one case per collection that has a detail page
    default:
      return <p>No preview for {preview.collection}.</p>;
  }
}
```

Hook details:

- `initial` must be referentially stable. Loader data is. A new `initial` object makes the hook return it until the next update.
- `cmsOrigin` turns the hook on. `null` or `undefined` (public pages, a missing env var, the server render) means no bridge.
- `resolve(result, info)` runs in the browser and may be async. `info` is `{ seq, locale }`. A rejected `resolve` keeps the last good value and logs `Live preview: could not resolve update <seq>. Keeping the last good value.`
- Results that finish out of order never replace newer ones (the hook uses `createLatestResolver`).
- The hook always draws the click-to-edit overlay. It has no `markers` option; use `createVisualBridge` directly if a page needs live updates without the overlay.
- Reuse the public page components (`ArticleView`) for the preview, so editors see the real page.

### Site content pages

The CMS opens `<previewPath>?arecaPreview=<token>`, for example `/?arecaPreview=…`. The page is also the public page, so it frames itself and starts the bridge only when the token is there.

```ts
// src/lib/home.server.ts
export const loadHome = createServerFn({ method: "GET" })
  .validator(z.object({ arecaPreview: z.string().optional() }))
  .handler(async ({ data }) => {
    const token = data.arecaPreview;
    // Only a preview link gets the CSP and a cmsOrigin. Public requests get null.
    const cmsOrigin = token ? frameForVisualEditing() : null;
    if (!token) return { ...homeView(content.globals, false, false), cmsOrigin };
    setNoStoreHeaders();
    try {
      const draft = await content.previewGlobals(token);
      const mine = draft.previewing === "homePage";
      return { ...homeView(mine ? draft.globals : content.globals, mine, mine && !draft.complete), cmsOrigin };
    } catch {
      // An expired or mistyped link shows the published page instead of an error.
      return { ...homeView(content.globals, false, false), cmsOrigin };
    }
  });

const liveGlobalInput = z.looseObject({
  kind: z.literal("global"),
  global: z.string().min(1),
  entry: z.looseObject({ data: z.record(z.string(), z.unknown()) }),
});

export const loadLiveHome = createServerFn({ method: "POST" })
  .validator((input: unknown) => liveGlobalInput.parse(input))
  .handler(async ({ data }) => {
    setNoStoreHeaders();
    const draft = await content.previewGlobals(data as unknown as PreviewResult);
    const mine = draft.previewing === "homePage";
    return homeView(mine ? draft.globals : content.globals, mine, mine && !draft.complete);
  });

// homeView(globals, preview, incomplete) builds exactly what the page renders.
```

```tsx
// src/routes/index.tsx
export const Route = createFileRoute("/")({
  validateSearch: (search) => z.object({ arecaPreview: z.string().optional().catch(undefined) }).parse(search),
  loaderDeps: ({ search }) => ({ arecaPreview: search.arecaPreview }),
  loader: ({ deps }) => loadHome({ data: { arecaPreview: deps.arecaPreview } }),
  component: Home,
});

function Home() {
  const loaded = Route.useLoaderData();
  const { home, preview, incomplete } = useLivePreview({
    initial: loaded,
    cmsOrigin: loaded.cmsOrigin,
    resolve: async (result) => ({ ...(await loadLiveHome({ data: result })), cmsOrigin: loaded.cmsOrigin }),
  });
  const field = useField();
  return (
    <section>
      {preview ? <PreviewBanner incomplete={incomplete} /> : null}
      <p {...field("heroIntro")}>{home.heroIntro}</p>
    </section>
  );
}
```

- Data the page loads besides the section (a team list, the latest posts) is not part of the live result. Carry it over in `resolve` (`{ ...live, authors: loaded.authors }`) so it does not disappear on the first update.
- A section's live result has `kind: "global"`. `content.previewGlobals` returns the published values with `previewing: null` for an entry result, and `previewFrom` throws for a global one, so use the matching function.
- Send `noindex` in the head when the page shows a draft.

### Markers context and the root layout

```tsx
// src/lib/visual-markers.tsx
import { createContext, useContext, type ReactNode } from "react";
import { field, type VisualFieldAttributes } from "@areca-cms/site-sdk/visual";

export type FieldFn = (key: string, owner?: { entry: string } | { global: string }) => Partial<VisualFieldAttributes>;
const noMarkers: FieldFn = () => ({});
const MarkersContext = createContext<FieldFn>(noMarkers);

export function VisualMarkers({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <MarkersContext.Provider value={enabled ? field : noMarkers}>{children}</MarkersContext.Provider>;
}

export function useField(): FieldFn {
  return useContext(MarkersContext);
}
```

```tsx
// src/routes/__root.tsx (inside the root component)
const onPreviewRoute = useMatch({ from: "/__preview/$collection/$slug", shouldThrow: false }) !== undefined;
const sitePreviewToken = useRouterState({
  select: (state) => (state.location.search as { arecaPreview?: unknown }).arecaPreview,
});
const sitePreview = typeof sitePreviewToken === "string" && sitePreviewToken !== "";

return (
  <VisualMarkers enabled={onPreviewRoute || sitePreview}>
    <SiteHeader />
    <main><Outlet /></main>
    <SiteFooter company={company} />
  </VisualMarkers>
);
```

Wrapping the whole layout lets the header and footer mark their site content fields (`field("email", { global: "companyInfo" })`) on every preview page.

### Prerender and caching

```ts
// vite.config.ts, tanstackStart({ prerender: { ... } })
filter: (page) => !page.path.startsWith("/__preview") && !page.path.startsWith("/api"),
```

A prerendered home page is fine for visitors, but a request with `?arecaPreview=` must reach the server. If a CDN or the prerender serves `/` statically for every query string, site content previews show the published page. Make sure query requests with `arecaPreview` bypass the static copy, or ask the user how the host routes them.

## Next.js (App Router)

The same parts, in Next.js terms. Folders that start with `_` are private in the App Router, so the `__preview` segment is spelled `%5F_preview`.

```text
app/%5F_preview/[collection]/[slug]/page.tsx   server component: reads ?token, content.preview(token)
app/%5F_preview/[collection]/[slug]/live.tsx   'use client': useLivePreview
app/preview-actions.ts                         'use server': renderLivePreview(result)
```

```ts
// app/preview-actions.ts
"use server";
import type { PreviewResult } from "@areca-cms/site-sdk";
import { content } from "@/generated/content/areca.gen";
import { liveEntryInput } from "@/lib/preview-input"; // the zod schema above

export async function renderLivePreview(result: unknown) {
  return content.previewFrom(liveEntryInput.parse(result) as PreviewResult);
}
```

```tsx
// app/%5F_preview/[collection]/[slug]/page.tsx
import { content } from "@/generated/content/areca.gen";
import { cmsOriginFrom } from "@/lib/cms-origin";
import { LivePreview } from "./live";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) return <p>Missing preview token.</p>;
  const preview = await content.preview(token); // catch 401/404 and show a short message
  return <LivePreview initial={preview} cmsOrigin={cmsOriginFrom(process.env.ARECA_CMS_URL)} />;
}
```

```tsx
// app/%5F_preview/[collection]/[slug]/live.tsx
"use client";
import { useLivePreview } from "@areca-cms/site-sdk/visual-react";
import { renderLivePreview } from "@/app/preview-actions";

export function LivePreview({ initial, cmsOrigin }: { initial: PreviewData; cmsOrigin: string | null }) {
  const preview = useLivePreview({ initial, cmsOrigin, resolve: (result) => renderLivePreview(result) });
  if (!preview.complete) return <IncompleteDraft issues={preview.issues} />;
  return <EntryView entry={preview.entry} />; // the public view components, marked with field()
}
```

Headers: set them in `next.config.ts` for the preview path, and for site content pages only when `arecaPreview` is in the query:

```ts
// next.config.ts
import { previewHeaders } from "@areca-cms/site-sdk";
import { visualEditingHeaders } from "@areca-cms/site-sdk/visual";

const cms = process.env.ARECA_CMS_URL;
const frame = cms ? Object.entries(visualEditingHeaders({ cmsOrigin: cms })) : [];
const headers = [...Object.entries(previewHeaders()), ...frame].map(([key, value]) => ({ key, value }));

export default {
  async headers() {
    return [
      { source: "/__preview/:path*", headers },
      { source: "/:path*", has: [{ type: "query", key: "arecaPreview" }], headers },
    ];
  },
};
```

- `next.config.ts` reads `ARECA_CMS_URL` when the server starts, so it must be set in the runtime environment.
- A server action is a POST, so `resolve` calling it matches the rule that live renders go through a POST server function. It returns plain data the client component renders.
- Site content pages: the page reads `searchParams.arecaPreview`, calls `content.previewGlobals(token)`, and passes `cmsOrigin` only when the token is present. Its server action calls `content.previewGlobals(result)` and keeps the draft only when `previewing` is the page's section. A page that reads `searchParams` is dynamic; ask before making a static home page dynamic.
- Gate markers with a context provider, as in the TanStack section, enabled from the server component (preview route or `arecaPreview` present).
