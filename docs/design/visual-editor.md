# Visual editor

Status: agreed with the product owner on 29 Oct 2026 (three grilling rounds). Delivered as four stacked PRs (see Rollout).

## Problem

Editors check how a change looks by pressing "View draft", which opens the site's preview route in a new tab. That breaks focus, and the tab only shows the last **saved** draft (autosave runs 2 s after typing stops), so it needs a refresh after every change.

The visual editor puts a live preview of the page beside the fields. It updates while the editor types, and clicking a part of the page jumps to the field that fills it.

## Vocabulary

- **Write mode**: today's editor (canvas + details aside).
- **Visual mode**: editor column on the left, preview on the right.
- **Preview URL**: the site origin the preview loads from. The new optional site setting, falling back to `productionUrl`.
- **Bridge**: the SDK script running inside the site's preview page (`@areca-cms/site-sdk/visual`). It talks to the CMS over `postMessage`.
- **Marker**: attributes a site puts on an element to say which field it shows (`areca.field('title')` → `data-areca-field="title"`).
- **Tier**: how much a site supports (below). Detected, never configured.

## Decisions

1. **Where.** Entries and section content (globals). Desktop only: Visual mode shows at **≥1280 px** viewport width. Below that the toggle is hidden and `?view=visual` falls back to Write mode.
2. **Tiers, detected automatically.**
   - **Tier 0, unavailable.** No preview URL can be built (new entry not saved yet, no slug). The Visual toggle is disabled with a reason ("Available after the first save").
   - **Tier 1, updates on save.** The preview loads but no bridge answers the handshake (3 s timeout). The iframe reloads after each successful autosave. Status: "Updates on save", with a "Preview blank?" help link explaining that the site must allow the CMS to frame its preview route.
   - **Tier 2, live.** The bridge answers. Unsaved values reach the page on every change. Status: "Live".
   - **Tier 3, click to edit.** The bridge reports markers. Hover and click map elements to fields.
3. **Live channel: `postMessage`.** Origins are pinned both ways: the CMS only talks to the preview URL's origin; the bridge only talks to the CMS origin (from its config). Messages are versioned (`areca:v1:*`) and carry a sequence number; stale updates are dropped.
4. **Payload built on the server.** A new server function takes the unsaved values (`data`, locale) and returns exactly the shape `/api/sites/preview` returns (camelCase, rich text, resolved references and assets) **without saving**. The editor calls it ~150 ms after a change. Same permission as editing the entry. On failure the last good preview stays and the status shows "Retrying…".
5. **No typing inside the preview.** All editing stays in the CMS fields (non-goal).
6. **Markers are explicit attributes**, not hidden characters in strings ("stega"). `field(key, { entry?, global? })` returns `data-areca-field` plus an owner (`data-areca-entry` or `data-areca-global`). `$seo.*` keys work as written.
7. **Layout.** A labelled segmented control in the editor top bar: `Write | Visual` (icon + text). Visual mode is full-bleed (no max-width container). The editor column defaults to **36 %** of the width, clamped to **400–720 px**; the user drags the divider between **360 px and 50 %**. The chosen ratio is remembered per browser (not pixels), so it scales across monitors. The column stacks: title, canvas fields, details fields, SEO. Write mode is unchanged.
8. **Mode is remembered** per browser and mirrored in the URL (`?view=visual`) so it survives refresh and can be shared.
9. **Preview toolbar.** Status, reload, width presets, Select / Browse (PR 3), "Show editable areas" (PR 3), open in new tab, and a labelled **Full screen** button.
10. **Width presets.** Desktop (fills the pane), **Fit 1440** (renders at 1440 px and scales down to fit, so a laptop sees the real desktop layout), Tablet 768, Mobile 390. Remembered per browser.
11. **Full screen is in-app.** The preview fills the window, the app chrome and editor column hide, and a floating toolbar stays with a clearly visible **Exit full screen** button (text + "Esc" hint). Esc or the button exits.
12. **Selection (PR 3).** Select is the default: hovering a marked element outlines it with the field's label; clicking scrolls to, focuses and pulses the field (~1.2 s). Links don't navigate in Select. A **Browse** toggle (or holding ⌥/Alt) uses the page normally. Focusing a field in the CMS outlines its element in the preview and scrolls it into view.
13. **Click in full screen (PR 3).** Clicking a marked element exits full screen, then focuses the field; the element stays outlined. Unmarked elements do nothing. A label hint follows the cursor over marked elements. After such an exit, a **Back to full preview** pill shows in the toolbar until used, ⌘⇧Enter, or another selection. Never re-enter full screen automatically.
14. **Hidden fields (PR 3).** A click on a field inside a collapsed group (SEO panel, section group) opens the group first. If the preview shows another language than the editor, the editor switches to the previewed language.
15. **Other owners (PR 3).** Elements marked with another entry or section (header, footer, referenced author) are verified in one server call: it exists on this site, is not deleted or archived, and this user can edit it. Only verified ones are outlined and open a popover "This is part of *Site content › Footer*. Open in visual editor", which saves the current entry before navigating. Unverified ones behave as unmarked.
16. **Show editable areas (PR 3).** A toolbar toggle draws faint outlines on every verified marker. Off by default, remembered.
17. **Browsing away (PR 3).** When the iframe leaves the entry's preview page, a bar shows: "You're viewing another page. Back to *Entry title*".
18. **New entries.** Visual becomes available after the first autosave creates the entry. A slug change moves the preview URL after the next save; live updates keep flowing before that.
19. **Discoverability and shortcuts.** First-time users land in Write mode; the Visual toggle carries a one-time "New" dot that clears on first use. Shortcuts: **mod+Shift+E** toggles Visual, **mod+Shift+Enter** toggles full screen, **Esc** exits full screen. `mod` is ⌘ on Mac and Ctrl elsewhere; tooltips show the user's OS keys (`useModifierKey`). Both appear in the Keyboard shortcuts dialog and as ⌘K commands. Not mod+Shift+V: that is "paste as plain text".
20. **Preview URL setting.** Optional, agency-only, in Settings › General. Falls back to `productionUrl`. "View draft" and the visual editor both use it. Lets an agency point previews at staging or `localhost`.
21. **SDK.** New subpaths `@areca-cms/site-sdk/visual` (framework-agnostic `createVisualBridge`, `field()`, `visualEditingHeaders()`) and `@areca-cms/site-sdk/visual-react` (`useLivePreview(initial)`). Version 0.9.0; not published to npm without the owner's go-ahead.
22. **Demo site.** Northbound gets the bridge and markers on every collection detail page (coffees, journal, team), the home and about sections, and header and footer (for cross-owner popovers).
23. **Strings** in `en`, `nl`, `tr` (Paraglide) in the same PR as the UI.

## Non-goals

- Typing or drag-and-drop inside the preview.
- Visual mode below 1280 px or on touch devices.
- Hidden-character ("stega") field mapping.
- Previewing list or index pages that show many entries (the preview is the entry's own page).
- Changing autosave, conflict handling or the release flow. The live preview only reads.
- Widening Write mode.

## Data model

Migration `visual_editor_preview_url`:

- `site.preview_url text null`. Validated as an `http(s)` URL with no path beyond `/`, or null. Null means "use `productionUrl`".

Helper `previewBaseUrl(site) = site.previewUrl ?? site.productionUrl` in a plain module (`lib/preview-url.ts`), used by `getPreviewUrlFn`, `getGlobalPreviewUrlFn` and the MCP `get_preview_url` tool.

## Server

- **CSP `frame-src`.** The CMS is a single-page app: the CSP header arrives with the first document and applies to every editor opened later, so `frame-src` cannot follow the current editor's site. Production: `frame-src 'self' https: http://localhost:* http://127.0.0.1:*` (http on other hosts would be mixed content from an https CMS anyway). Development: `frame-src 'self' http: https:`. `frame-ancestors 'none'` and `X-Frame-Options: DENY` stay: nothing may frame the CMS.
- **Live payload function (PR 2).** `buildLivePreviewFn({ siteId, collection | global, data, locale })` reuses the `/api/sites/preview` payload builder on unsaved data. Authz: same as `updateDraftFn`. Body size capped like draft saves. Rate-limited per user.
- **Marker verification (PR 3).** `resolvePreviewOwnersFn({ siteId, owners: [{ entry } | { global }] })` returns, per owner, `{ label, collectionLabel, href }` or nothing. At most 100 owners per call.
- **Preview token refresh.** The editor refetches the preview URL every 50 minutes while Visual mode is open (tokens last 1 h).

## Bridge protocol (PR 2/3)

All messages are `{ type: 'areca:v1:<name>', … }`.

| Direction | Type | Payload |
| --- | --- | --- |
| site → CMS | `hello` | `{ sdkVersion, markers: boolean }` (answers `ping`) |
| CMS → site | `ping` | `{}` (sent on iframe load until `hello`, max 3 s) |
| CMS → site | `update` | `{ seq, entry | global, locale }` |
| site → CMS | `markers` | `{ owners: Owner[] }` (after render) |
| site → CMS | `select` | `{ field, owner }` |
| CMS → site | `highlight` | `{ field, owner } \| null` |
| CMS → site | `mode` | `{ select: boolean, showAreas: boolean, labels, verified: Owner[] }` |
| site → CMS | `navigate` | `{ url, onEntryPage: boolean }` |

The bridge draws outlines and label chips itself, in a shadow root so site CSS cannot reach them, using styles the CMS sends.

## UI

- **Top bar:** `Write | Visual` segmented control (hidden below 1280 px; disabled with reason at Tier 0). One-time "New" dot.
- **Visual layout:** editor column | 6 px draggable divider (keyboard: arrow keys move it 16 px, focusable, `role="separator"`) | preview pane.
- **Preview pane:** toolbar (status pill, reload, width segmented control, Select/Browse, editable areas, open in new tab, Full screen), then the frame area. Desktop preset fills the pane; Tablet and Mobile are centred on a subtle backdrop; Fit 1440 scales.
- **Full screen:** fixed overlay above the app; floating toolbar top with **Exit full screen (Esc)** on the right.

## Testing

Test-first where possible.

- Unit: column ratio clamp, width presets and fit scale, Tier detection reducer, protocol message guards, origin checks, `previewBaseUrl`, CSP `frame-src`.
- Integration: `updateSite` accepts and clears `previewUrl` (agency only); live payload equals `/api/sites/preview` output for the same saved data; owner verification hides deleted, archived and foreign-site entries.
- e2e (Playwright), with the site origin served by `page.route` fixtures: toggle and remembered mode at 1280, 1440, 1920; hidden at 1024 and 390; Tier 1 reload after autosave; width presets; full screen enter and exit (button and Esc); shortcuts; ⌘K command; later Tier 2 live typing, Tier 3 click-to-field both ways, full screen click exit, cross-owner popover, browse-away bar. A full click-around walkthrough with screenshots.

## Rollout

1. **PR 1:** this spec, Preview URL setting, CSP `frame-src`, Visual mode layout with Tier 0/1 (iframe, toolbar, widths, reload on save, full screen, shortcuts, ⌘K, New dot).
2. **PR 2:** SDK bridge (`/visual`, `/visual-react`), live payload function, Tier 2 live updates, Northbound wiring.
3. **PR 3:** Tier 3: markers, select / browse, both-way highlight, full-screen click exit + Back pill, hidden-field reveal, cross-owner verification + popover, editable areas, browse-away bar.
4. **PR 4:** section content (globals) visual mode, SDK and CMS docs with screenshots, `areca-sdk` skill, polish.
