# Changelog

All notable changes to `@areca-cms/site-sdk`.

## 0.5.0 (2026-10-15)

### Features

- **sdk:** match the CMS language wire shape and cover it end to end (a08a89f)
- **sdk:** content languages in the SDK (702fd90)

## Unreleased

### Features

- content languages: `createContent({ locale })`, per-call `{ locale, fallback }` on every collection method, `content.in(locale)`, `content.languages`, `content.matchLocale(input)` and the `matchLocale(input, languages)` helper. Entries and site content sections report the language they are served in (`locale`, `isFallback`, `locales`, `alternates`, and `$locale`/`$isFallback` on globals).
- `languages`, `routes`, `requiredLanguages` and per-field `translatable` in `areca.config.ts`. `areca.gen.ts` emits the `Locale` union and `languages`.
- `i18n.paraglide` in `areca.config.ts` wires Paraglide's `getLocale` into the generated content object. `areca pull` warns when `project.inlang/settings.json` disagrees with the CMS languages.
- `seoHead` and `seoHeadHtml` accept `locale`, `alternates`, `main` and `siteUrl` for `hreflang`, `x-default` and `og:locale`.

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
