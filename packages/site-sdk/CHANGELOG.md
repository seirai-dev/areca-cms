# Changelog

All notable changes to `@areca-cms/site-sdk`.

## 0.9.0 (2026-10-29)

### Features

- **visual editing:** `@areca-cms/site-sdk/visual` adds `createVisualBridge`, which connects a preview page to the CMS over `postMessage` and applies each newer update. It only talks to the CMS origin, and it does nothing outside an iframe. `visualEditingHeaders` builds the `frame-ancestors` policy for the preview route.
- **visual editing:** `field(key, owner?)` in `@areca-cms/site-sdk/visual` marks an element as showing a field. The editor outlines marked elements in Select mode and jumps to the field on click. Owners are another entry (`{ entry }`) or a site content section (`{ global }`, such as the header or footer). Browse, or holding Option/Alt, uses the page normally. Markers do nothing outside the visual editor.
- **visual editing:** the bridge reports client-side navigations, so the editor can show when the preview has left the entry's page. `hello` now includes the page address and whether markers are reported. `createVisualBridge` takes `markers: false` to turn the overlay off.
- **visual editing:** `@areca-cms/site-sdk/visual-react` adds `useLivePreview`, which shows the published value until the CMS sends an update, then the latest resolved value.
- **content:** `content.previewFrom(result)` turns a preview result the CMS already returned into the same entry `content.preview(token)` gives, without a request. `preview()` behaves as before. `previewFrom` is now a reserved collection and site content name.

### Bug Fixes

- **browser:** the main entry (`@areca-cms/site-sdk`) no longer pulls `node:crypto` and `node:path` into browser bundles through the client's asset downloader. Pages that imported `seoHead` or `richTextDocument` failed to hydrate under Vite.

## 0.8.0 (2026-10-27)

### Features

- **dev-env:** Development tab, switcher nesting, dev banner and hidden releases (179f923)

## 0.7.0 (2026-10-26)

### Features

- **sdk:** manifest pull asks only when something would be removed (a265c3e)
- **skills:** add areca-quickstart skill and set_publishing_mode MCP tool (3c1bdbd)

## 0.6.0 (2026-10-23)

### Features

- **manifest push confirms field removals.** The CMS refuses a push that removes a field which still holds content and lists each field with its entry count. `areca manifest push` shows that list, asks on a terminal (default No), and accepts `--confirm-drop <collection.field>` (repeatable) or `--yes`. `syncManifest(config, { confirmDropFields })` sends the confirmations, and a refusal throws `FieldDropsRequiredError` with the drops.
- **manifest pull reviews languages.** The review lists added and removed languages and a new main language. Removing a language or changing the main language asks before writing (default No), or needs `--yes` without a terminal.
- **`Href` follows the language.** `Href` is the union of every language's route, and `content.in(locale)` narrows the collection `href` results to that language's route.
- Media downloads cover every language view. The SDK previously rewrote only the top-level data, so the main language and other languages kept CMS URLs.
- `createArecaClient` no longer requires `ARECA_SITE_TOKEN` at construction. Each call checks the credential it sends and names the missing variable before any request. Schema-only and preview-only clients work with their own credential alone, and previews send no `Authorization` header.
- content languages: `createContent({ locale })`, per-call `{ locale, fallback }` on every collection method, `content.in(locale)`, `content.languages`, `content.matchLocale(input)` and the `matchLocale(input, languages)` helper. Entries and site content sections report the language they are served in (`locale`, `isFallback`, `locales`, `alternates`, and `$locale`/`$isFallback` on globals).
- `languages`, `routes`, `requiredLanguages` and per-field `translatable` in `areca.config.ts`. `areca.gen.ts` emits the `Locale` union and `languages`.
- `i18n.paraglide` in `areca.config.ts` wires Paraglide's `getLocale` into the generated content object. `areca pull` warns when `project.inlang/settings.json` disagrees with the CMS languages.
- `seoHead` and `seoHeadHtml` accept `locale`, `alternates`, `main` and `siteUrl` for `hreflang`, `x-default` and `og:locale`.
- **sdk:** confirm field removals on manifest push (b239d17)
- **sdk:** review language changes in manifest pull (4a65b91)
- **sdk:** type Href by language and narrow it in content.in() (7fae327)

### Bug fixes

- Documentation: the rich-text renderer installs `@tanstack/markdown@1.0.0`, the version the SDK depends on. A docs check fails when an install command names another version.
- **sdk:** export FieldDropsRequiredError from the package entry (8ed302d)
- **sdk:** resolve each credential only for the call that sends it (bb2c5d1)
- **sdk:** rewrite media URLs in every language view (86ba2c4)

## 0.5.0 (2026-10-15)

### Features

- **sdk:** match the CMS language wire shape and cover it end to end (a08a89f)
- **sdk:** content languages in the SDK (702fd90)

## 0.4.0 (2026-10-14)

### Features

- add site content (globals) sections (b1c0aaf)
- implement full end-to-end types (86c76bb)

### Bug fixes

- address review feedback on site content globals (46791c2)

## 0.3.0 (2026-10-11)

### Features

- copy media into client sites on areca pull (da09a0c)

### Bug fixes

- address review findings on local media pulls (884ad8a)

## 0.2.1 (2026-10-10)

No user-facing changes.
