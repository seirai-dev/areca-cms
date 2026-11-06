---
name: areca-visual-editing
description: Sets up a website for the Areca CMS visual editor, which shows the site's preview page in an iframe next to the fields, updates it live as editors type and lets them click part of the page to jump to its field. Covers the frame-ancestors header, the bridge (useLivePreview, createVisualBridge), rendering unsaved values on the server with content.previewFrom and content.previewGlobals, site content pages with previewPath and arecaPreview, click-to-edit markers with field() and owners, gating markers to preview pages, the CMS Preview URL setting, languages, React, Next.js, Astro, SvelteKit and plain Node, and troubleshooting a blank preview or one stuck on Updates on save. Use when the user mentions the visual editor, live preview, click to edit, data-areca attributes, @areca-cms/site-sdk/visual or visual-react, or a preview that is blank or does not update.
license: MIT
metadata:
  version: "0.9.1"
---

# Areca visual editing

The Areca CMS **visual editor** shows the site's own preview page in an iframe beside the editor's fields. Editors open it with the **Write | Visual** switch in the entry editor (screens 1280 px wide or more). What the editor gets depends on what the site supports. The CMS detects it; there is nothing to switch on in the CMS.

| Level | Status pill in the CMS | What the editor gets | What the site adds |
| --- | --- | --- | --- |
| Not available | toggle disabled | Nothing. New entries get Visual after the first autosave. | A preview URL and a slug (or `previewPath` for site content). |
| Updates on save | "Updates on save" | The iframe reloads after each autosave. | A working preview route that the CMS may frame (step 1). |
| Live | "Live" | Unsaved values show on every change, about 150 ms after typing. | The bridge and a server render of unsaved values (steps 2 and 3). |
| Click to edit | "Live", with "Click part of the page to edit it." | Hover outlines a field with its label. A click focuses that field in the editor. | `field()` markers on preview pages (step 4). |

The visual editor only reads. It never saves or publishes, and the unsaved values it sends are never written anywhere.

This skill builds on the `areca-sdk` skill (config, `content`, the preview route). Read that skill for anything not about visual editing.

## How it works

```text
CMS editor ──iframe──> <site>/__preview/<collection>/<slug>?token=…       (entries)
                       <site><previewPath>?arecaPreview=<token>           (site content)
  1. Site server: content.preview(token) / previewGlobals(token), sends frame-ancestors, returns cmsOrigin
  2. Browser: the bridge posts `hello` to the CMS. The CMS starts sending `update` messages.
  3. Each update = { seq, result, locale }. `result` is a PreviewResult built from the unsaved values.
  4. Browser sends `result` to a site server function -> content.previewFrom(result) or
     content.previewGlobals(result) -> the page re-renders. Older results never replace newer ones.
  5. The bridge's overlay finds data-areca-* markers, reports them, outlines them and reports clicks.
```

The content object reads the pulled files with Node, so **rendering always happens on the site's server**. The browser only relays the result.

## Before you start

Check each item. Fix or ask about the ones that fail before writing code.

1. **SDK version.** `@areca-cms/site-sdk` 0.10.0 or newer (live updates arrived in 0.9.0, the finished click to edit in 0.10.0). Upgrade with the package manager the project uses.
2. **A draft preview route already works.** `/__preview/$collection/$slug?token=` must render a draft with `content.preview(token)`. If it does not exist, build it first from the `areca-sdk` skill (`references/production.md`). Visual editing is added on top of it.
3. **Site content pages** (globals) that should be visual need `previewPath` on the section (in `areca.config.ts`, then `areca manifest push`), and the page at that path must read `?arecaPreview=`. A section without `previewPath` cannot open in Visual mode.
4. **Where the CMS loads the preview from.** The CMS uses the site's **Preview URL** (Settings › General, agency admins only), or the **Production URL** when it is empty. It must be an origin only (`https://staging.example.com`, no path). A production CMS frames only `https:` addresses plus `http://localhost` and `http://127.0.0.1`. An `http://` LAN or staging address shows a blank preview. Ask the user which URL the CMS uses; don't guess it.
5. **The CMS origin.** The site must know the exact CMS origin (scheme, host and port). Use the origin of `ARECA_CMS_URL`, read on the server at request time. Make sure that variable (and `ARECA_SITE_TOKEN`) reach the **runtime** environment of the server that serves previews, not only the build. A Docker image that sets them only in the build stage has no `cmsOrigin` at run time.
6. **The framework can run server code per request** for the preview route and for live renders. A fully static site cannot go past "Updates on save" without an SSR route or server endpoint. Ask before changing a project's output mode (for example Astro `output`).

## Steps

Follow the steps in order. Framework code is in the references:

- React with TanStack Start or Next.js: [references/react.md](references/react.md).
- Astro, SvelteKit, Vue, Express, Hono or plain Node: [references/other-frameworks.md](references/other-frameworks.md).

### Step 1: let the CMS frame the preview page

```ts
import { previewHeaders } from "@areca-cms/site-sdk";
import { visualEditingHeaders } from "@areca-cms/site-sdk/visual";

// On the preview response only:
const headers = { ...previewHeaders(), ...visualEditingHeaders({ cmsOrigin }) };
// Content-Security-Policy: frame-ancestors 'self' https://cms.example.com
// X-Robots-Tag: noindex, nofollow   Cache-Control: no-store
```

- Send it on `/__preview/*` responses, and on site content pages **only when `?arecaPreview=` is present**. Never on public responses.
- `cmsOrigin` takes a string or an array (for example production and a local CMS). Paths are dropped. It throws for a value without a scheme or a `file:` URL, so derive the origin safely and pass `null` when it is unknown (see `cmsOriginFrom` in [references/react.md](references/react.md)).
- The helper returns a whole `Content-Security-Policy` header. If the site already sends a CSP on that route, merge the `frame-ancestors` directive into it instead of replacing it.
- Remove any `X-Frame-Options` header from preview responses.

At this point the editor gets "Updates on save".

### Step 2: connect the bridge

The loader of the preview page returns the preview data plus `cmsOrigin` (the CMS origin, or `null`).

- **React:** `useLivePreview({ initial, cmsOrigin, resolve })` from `@areca-cms/site-sdk/visual-react`. It returns `initial` until an update resolves, then the latest value `resolve` returned.
- **Anything else:** `createVisualBridge({ cmsOrigin, onUpdate })` from `@areca-cms/site-sdk/visual`. Call `destroy()` when the page goes away, and apply results through `createLatestResolver` so a slow, older render never replaces a newer one.

Both do nothing on the server, outside an iframe, or with a `null` cmsOrigin, so the same page component serves public and preview requests.

### Step 3: render unsaved values on the server

`resolve` (or `onUpdate`) sends the result to a **POST** server function or endpoint:

```ts
// server only
content.previewFrom(result);          // entry: same shape as content.preview(token): { collection, slug, complete, issues, entry }
await content.previewGlobals(result); // site content: { globals, previewing, complete, issues }, no request is made
```

- `content.preview(token)` and `content.previewFrom(result)` return the same type, so the first render and the live renders can share one code path.
- Validate the posted body before use (the demo uses zod). `previewFrom` throws for a site content result, for a collection that is not in the generated schema, and with a raw `TypeError` for a body without `entry`.
- Handle `complete: false`: required fields may be empty while the editor types. Show `issues` or a light placeholder rather than crashing.
- On a site content page, keep the draft only when `previewing` is that page's section; otherwise keep the published values.
- Set `previewHeaders()` (`no-store`) on the live response too.

At this point the editor gets "Live".

### Step 4: mark fields for click to edit

```tsx
import { field } from "@areca-cms/site-sdk/visual";

<h1 {...field("title")}>{entry.data.title}</h1>                           // this page's entry
<p {...field("$seo.summary")}>{entry.seo?.summary}</p>                    // SEO value
<span {...field("name", { entry: author.id })}>{author.data.name}</span>   // a referenced entry
<a {...field("email", { global: "companyInfo" })}>{company.email}</a>     // a site content section
```

- `field()` never checks where it runs. **Gate it**: render markers only on preview pages (the `__preview` route, or a page with `?arecaPreview=`). Public HTML must contain no `data-areca-*` attributes.
- Put the marker on the element that shows the value: the wrapper of a rich text body, the `<img>` of an image, the list of a multi-value field.

Read [references/markers.md](references/markers.md) for keys, owners, nesting, limits and the gating pattern.

### Step 5: verify

1. Open the public page: no `frame-ancestors` header, no `data-areca-*` attributes, no bridge activity.
2. Open a preview URL directly (from the CMS "Open preview in a new tab" or the MCP `get_preview_url` tool): it renders the draft and sends `frame-ancestors` with the CMS origin, `no-store` and `noindex`.
3. Ask the user to open an entry in the CMS, switch to **Visual**, and report the status pill. "Live" means steps 2 and 3 work. Typing should change the page within a second.
4. In Select mode, hovering a marked element outlines it with the field label, and clicking focuses the field. Ask the user to try a referenced entry and a footer field: those open a "This is part of …" popover.
5. Repeat for each site content page with a `previewPath`.

The visual editor needs a signed-in CMS user (often with 2FA), so ask the user to do the CMS steps and report back. Don't try to sign in.

## Rules

- Frame header, markers and the bridge's `cmsOrigin` belong to preview responses only. Public pages stay unchanged.
- Never import the content object, `@areca-cms/site-sdk/pull` or anything that reads tokens into browser code. The browser calls a server function; the server renders.
- Treat a posted live result as untrusted input. Validate it, keep the endpoint POST with a JSON body, and return data or JSON, never a raw HTML response to a form post.
- Keep `/__preview/*`, live endpoints and `?arecaPreview=` responses out of prerendering and caches.
- Don't hard-code the CMS origin in client bundles or behind `VITE_`/`NEXT_PUBLIC_`/`PUBLIC_` env vars; pass it from the server loader.
- Never change CMS settings (Preview URL, `previewPath`, production URL) without asking. Settings are agency-admin only.
- Don't build a custom bridge. The SDK implements the protocol; [references/cms.md](references/cms.md) documents it for debugging only.

## More

- [references/cms.md](references/cms.md): what editors see, the CMS settings, preview URLs and tokens, languages, the CMS frame policy, the message protocol and limits.
- [references/troubleshooting.md](references/troubleshooting.md): symptom, cause and fix for a blank preview, "Updates on save", nothing clickable and more.
