# The CMS side

What happens in the CMS, so you can set the site up to match and explain it to the user.

## What editors see

- The entry editor's top bar has a **Write | Visual** switch (keyboard: Cmd/Ctrl+Shift+E; full screen: Cmd/Ctrl+Shift+Enter; Esc leaves full screen). It is hidden below 1280 px wide. The last mode is remembered, so editors who used Visual open entries in Visual.
- Visual shows the fields on one side and the iframe on the other, with width presets (Desktop, Tablet, Mobile, "1440 fit"), Reload, "Open preview in a new tab", Full screen, and a Select/Browse switch with "Show editable areas".
- Status pill: "Connecting…" while waiting for the bridge (up to 3 s), then "Live" or "Updates on save". "Retrying…" means the last live request failed; the last good preview stays.
- "Preview blank?" link (with "Updates on save"): "Your site must allow Areca to show its preview page in a frame. Ask your developer to allow this CMS address in the site's frame-ancestors setting."
- When the preview navigates away from the entry's page: "You're viewing another page." with "Back to …".
- Site content sections (Site content › a section) get the same switch when the section has a `previewPath`. Without one the switch says "Preview is not set up for this section yet. An agency admin can add a preview path."
- Collection entries: "Available after the first save" for a new entry, and "Add a slug to preview this entry" for an entry without a slug.

## Settings that affect it

| Setting | Where | Who | Effect |
| --- | --- | --- | --- |
| Preview URL | Settings › General | Agency admins | Origin the CMS loads previews from, e.g. a staging site or `http://localhost:3000`. Empty: the Production URL is used. Origin only: no path, query, hash or credentials. |
| Production URL | Site settings | Agency admins | Fallback for the preview origin. Required for any preview. |
| `previewPath` | Section definition (`areca.config.ts` then `areca manifest push`, the schema editor, or MCP `upsert_global`) | Agency admins / schema token | The page that shows a site content section. Required for its Visual mode. |
| `seo: true` on a section | Section definition | Same | Makes the section's `$seo.*` keys clickable. |

There is no on/off switch for visual editing. The CMS detects what the site supports every time the iframe loads.

For local development, set the Preview URL to the dev server (`http://localhost:<port>`) and set the dev server's `ARECA_CMS_URL` to the CMS the editor uses. Dev environments (throwaway copies of a site) have their own Preview URL field.

## Preview URLs and tokens

| Kind | URL the iframe loads |
| --- | --- |
| Collection entry | `<preview origin>/__preview/<collection>/<slug>?token=<token>` |
| Site content section | `<preview origin><previewPath>?arecaPreview=<token>` |

- The collection key and slug are the CMS's raw values. The slug is the saved slug; a slug change moves the preview after the next save.
- The token is signed by the CMS for one site and one entry or section, and lasts one hour. While Visual is open the CMS fetches a fresh URL every 50 minutes. The site treats the token as opaque: it passes it to `content.preview(token)` / `content.previewGlobals(token)` (which call `GET <cms>/api/sites/preview?token=…`). Never log, cache or store it.
- `GET /api/sites/preview` returns 401 for a missing, malformed or expired token and 404 when the content is gone. It answers `{ kind: "entry", collection, slug, entry }` or `{ kind: "global", global, entry }`. Older CMS versions leave `kind` out for entries.
- The same URLs work outside the editor (the "Open preview in a new tab" button, and the MCP `get_preview_url` tool), so the preview route must render well on its own too.

## Live updates

- The CMS builds the live result from the editor's unsaved values on its own server (`POST /api/editor/live-preview`, rate limited per user), about 150 ms after the last change, with one request in flight at a time. Nothing is written.
- The result has the exact shape of a token preview, so `content.previewFrom(result)` and `content.previewGlobals(result)` read it like a fetched preview.
- Each `update` message carries an increasing `seq`. The bridge drops older ones; `createLatestResolver` drops results of renders that finish out of order.
- Without a bridge, the iframe reloads 800 ms after each successful autosave instead.

## Languages

- Each `update` carries `locale`, the language the editor is editing (`null` on single-language sites). `info.locale` gives it to `resolve` and `onUpdate`.
- `content.previewFrom(result)` serves the draft in its own language (`result.entry.locale`) when no `locale` option or `content.in(locale)` scope is set. Leave the option out so the preview follows the editor's language.
- The iframe URL itself does not carry a language from the visual editor. The first load (and every reload) shows the main language, and the live updates switch to the editor's language. On a site at "Updates on save" the preview always shows the main language. A `locale` query parameter, when present (MCP `get_preview_url` with `locale`, links from elsewhere), should be passed through: `content.preview(token, { locale })`.
- The `/__preview` route has no language prefix. Set `<html lang>` and UI strings from the entry's `locale` if the page shows them.

## The CMS frame policy

The CMS's own CSP decides which sites it may frame:

- Production CMS: `frame-src 'self' https: http://localhost:* http://127.0.0.1:*`. Any `https:` site, plus local dev servers. `http://` on any other host (LAN IPs, `http://staging…`) is blocked even though the Preview URL setting accepts it.
- CMS in development (`vite dev`): any `http:` or `https:` site.

The iframe is sandboxed with `allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox`. The page runs as its own origin, so cookies, storage and fetches to its own server work. Top navigation is not allowed.

## Protocol

For debugging only. The SDK bridge implements all of it. Every message is `{ type: "areca:v1:<name>", ... }`, sent with an exact target origin, and checked on arrival for origin, source window and shape. Messages with another prefix or a bad shape are dropped without a log on both sides.

| Direction | Type | Payload |
| --- | --- | --- |
| site → CMS | `hello` | `{ sdkVersion, markers: boolean, url }`. Sent when the bridge starts and in answer to each `ping`. |
| CMS → site | `ping` | `{}`. Every 250 ms after the iframe loads, until `hello` or 3 s. |
| CMS → site | `update` | `{ seq, result, locale }` |
| site → CMS | `markers` | `{ markers: { field, owner }[] }`, at most 500. After render, on change, after each `ping`. |
| CMS → site | `mode` | `{ select, showAreas, cursorHint, color: "#rrggbb", targets: { field, owner, label }[] }`. Only targets are outlined and clickable. |
| site → CMS | `select` | `{ field, owner, rect }`: a click on a target in Select mode. |
| CMS → site | `highlight` | `{ target: { field, owner } \| null }`: the editor focused a field. |
| site → CMS | `navigate` | `{ url }`: the page URL changed (client routing, history, hash). |
| site → CMS | `escape` | `{}`: Esc pressed in the page. |

`owner` is `null` (the page's own entry or section), `{ entry: id }` or `{ global: key }`. `sdkVersion` is informational; nothing negotiates versions. `SDK_VERSION` (exported) is the value sent. The limits are exported as `MARKER_TEXT_MAX` (200), `MARKERS_MAX` (500) and `URL_MAX` (4096). `isArecaMessage(value)` is the runtime check for a message, and `markerKey(marker)` the identity the overlay uses for a marker (`entry:<id>|<field>`, `global:<key>|<field>` or `|<field>`).

Exported message types, for a custom integration test: `ArecaMessage`, `PingMessage`, `HelloMessage`, `UpdateMessage`, `MarkersMessage`, `SelectMessage`, `NavigateMessage`, `EscapeMessage`, `HighlightMessage`, `ModeMessage`, `Marker`, `MarkerOwner`, `MarkerTarget`, `MarkerRect`, `PreviewUpdateInfo`, `VisualBridgeOptions`, `VisualBridge`, `BridgeWindow`, `BridgeMessageEvent`. From `visual-react`: `LivePreviewOptions`.
