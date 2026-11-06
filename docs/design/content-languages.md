# Content languages (multilingual content)

Status: implemented. This is the design note written before the feature was built; the code and the [docs site](https://docs.arecacms.com) are the source of truth where they differ.

## What it is

A site can publish the same entry or site-content section in several
languages (e.g. a vacancy in NL + EN, a blog post in NL, EN and FR). The
agency picks the site's languages and its **main language** (the fallback).
Editors write each language in the same entry. The site asks the SDK for the
visitor's language and gets that version, or the main language when the
translation is not there.

Naming: in the CMS UI this is **Languages** / "content languages". Never
"locale" in UI copy, and never mixed up with the CMS's own *interface
language* (Paraglide en/nl/tr), which is unrelated. Code/SDK/API name:
`locale` (BCP 47 tag, e.g. `nl`, `en`, `nl-BE`).

A site without languages configured behaves exactly as today. No UI,
snapshot field, SDK type or MCP parameter changes for it.

## Decisions (user, 15 Oct 2026)

| Topic | Decision |
|---|---|
| Lifecycle | One lifecycle per entry. "Mark ready", schedule and go live act on the entry as a whole. |
| Required languages | Per collection / section: `requiredLanguages`. The main language is always required. Ready/schedule is blocked until every required language is complete. |
| Optional languages | Ship only when **complete** (every required *translatable* field filled in that language). Otherwise visitors get the fallback. |
| Translatable fields | Per field `translatable` switch, agency-controlled. Defaults: `text`, `textarea`, `richtext`, `url` = on; `image`, `date`, `datetime`, `select`, `reference`, `boolean`, `number` = off (shared). Any field may be overridden (e.g. a per-language image). `$seo` is always per language. |
| Fallback | Default-language version, flagged `isFallback: true`, with the list of available languages. Query option `fallback: false` excludes untranslated entries instead. |
| Fallback chain | requested → exact match, then language subtag (`nl-BE` → `nl`), then main language, then the first complete language in site order. |
| Empty optional field inside an available translation | Stays empty (no per-field mixing). Exception: slug falls back to the main slug. |
| Slugs | Optional per-language slug; defaults to the main slug. Unique per collection **per language**. |
| Route patterns | Optional per-language pattern per collection (`routes: { nl: '/vacatures/$slug' }`), defaulting to `route`. Patterns never contain the locale prefix; the site adds it (Paraglide `localizeHref`). |
| Config | Site settings → Languages (agency), **and** `areca.config.ts` `languages` (synced by manifest push/pull like the schema). `areca pull` warns when they differ from Paraglide `project.inlang/settings.json`, and generates a typed `Locale` union. |
| Editor | Sticky language bar above the canvas with completeness per language; non-main languages show the main-language text as a muted reference with Copy / Translate. Shared fields marked "Same in all languages". `?lang=` in the URL, remembered per site. |
| AI | "Translate from <main>" per language and per field, via the existing agency OpenRouter AI. Fills **empty** fields only, unless the user confirms overwrite. Result is an ordinary draft edit. |
| Entry list | Language coverage chips per row + "Missing translation: <language>" filter (also on MCP `list_entries`). |
| Alt text | Per language on the asset; `ImageValue.alt` follows the locale, falls back to main. |
| Change main language | Allowed. Confirm dialog shows how many entries/sections lack the new main language. Nothing is deleted; live content keeps serving (fallback chain); affected entries show "Needs <language>" and can't be marked ready until filled. |
| Remove a language | Hide, keep the data. Stops shipping, disappears from the editor, restored if re-added. Type-to-confirm dialog. |
| Turn languages off | Not possible once set; reduce to one language instead (behaves as single-language). |
| SDK | Locale resolver wired once (Paraglide first-class via codegen; any library via a function), per-call `{ locale }` and scoped `content.in(locale)` overrides. |
| MCP | Every content tool takes `locale`; site info reports languages; schema tools accept the new settings. |
| Demo + docs | examples/demo-site becomes NL + EN with Paraglide, localized routes and a switcher. Docs: CMS Languages, SDK i18n (Paraglide + recipes for i18next, next-intl, vue-i18n, Lingui), MCP locale params. |

## Storage (CMS)

### Site

`site.languages jsonb null` — `{ main: string; all: string[] }`.
`all` is ordered (switcher order and the last step of the fallback chain)
and includes `main`. `null` = single-language site. Removing a language
removes it from `all` only; its data stays in entries.

### Collection / section

- `collection.required_languages text[] not null default '{}'` — languages
  required besides `main` (main is implied, never stored). Codes not in
  `site.languages.all` are ignored.
- `collection.localized_routes jsonb null` — `Record<locale, pattern>`;
  collections only.
- `Field.translatable?: boolean` (in the `fields` jsonb). Absent = the type
  default above. Resolve only through `isTranslatable(field)`.

### Entry data

Today's shape stays the base. Translations sit in a reserved key next to
`$seo`:

```jsonc
{
  "title": "Backend ontwikkelaar",   // base: shared fields + translatable fields in the base language
  "salary": 4000,
  "$seo": { ... },                    // base-language SEO
  "$locale": "nl",                    // optional: language of the base values (see invariant)
  "$i18n": {
    "en": { "title": "Backend developer", "$slug": "backend-developer", "$seo": { ... } },
    "fr": { "title": "Développeur backend" }
  }
}
```

- `$i18n.<locale>` holds only translatable keys, `$slug` and `$seo`.
- Shared fields exist only in the base.
- **Invariant:** data without `$locale` is in the site's *current* main
  language. When the main language changes, one UPDATE per table stamps
  `$locale: <old main>` onto `draftData`, `publishedData`, `scheduledData`
  and `entry_revision.data` that lack it. Writes normalise: when a draft is
  saved and `$locale` ≠ main, the base and `$i18n[main]` are swapped so the
  base converges back to the main language and `$locale` is dropped.
- Toggling `translatable` off: the base value is kept; `$i18n.*.<key>` is
  ignored (kept, not deleted). On: other languages start empty.
- `entry.slug` stays the main-language slug. Per-language slug uniqueness is
  checked in validation against other entries' `$i18n.<locale>.$slug` and
  main slugs.

All reading/writing of `$i18n` / `$locale` goes through one module,
`apps/cms/src/lib/content-locale.ts` (pure, shared by server and client):

```ts
isTranslatable(field): boolean
readLocale(data, locale, ctx): EntryData          // flat view of one language (shared + translatable + $seo + $slug)
writeLocale(data, locale, values, ctx): EntryData // inverse; shared keys go to the base
localeStatus(data, fields, locale, ctx): { complete: boolean; missing: string[]; started: boolean }
normalizeBase(data, ctx): EntryData
// ctx = { main: string; all: string[]; fields: Field[] }
```

### Assets

`asset.alt_i18n jsonb not null default '{}'` — `Record<locale, string>`;
`asset.alt` stays the main-language alt.

## Validation and lifecycle

- Draft saves: `partial` mode for every language (as today), plus
  per-language slug format/uniqueness.
- Mark ready / schedule (`publishEntry`, `scheduleEntry`) and section
  blockers (`sectionBlockers`): `strict` for shared fields + main language,
  and for each language in `requiredLanguages ∩ all`. Error messages name the
  language and fields: `English is missing: Title, Body`.
- `buildSnapshot` re-validates the same way.
- Optional languages are never a blocker.

## Snapshot (wire contract)

Additive; older SDKs keep reading `data`/`slug` and get the main language.

```ts
Snapshot.languages?: { main: string; all: string[] }   // absent on single-language sites

SnapshotEntry.locale?: string            // language of `data`/`slug`/`seo` (main, or first complete in the chain)
SnapshotEntry.locales?: Record<string, { // only COMPLETE languages, main included when complete
  slug: string                           // per-language slug, or main slug
  data: Record<string, unknown>          // full flat view: shared + translatable; images carry localized alt
  seo?: SeoMeta
}>
SnapshotGlobal.locale? / SnapshotGlobal.locales?   // same, no slug

SnapshotSchema[key].routes?: Record<string, string>
SnapshotSchema[key].requiredLanguages?: string[]
Field.translatable?: boolean           // in schema + globalSchema
```

`hash` covers `languages` and `locales`. Preview tokens gain an optional
`locale`; `/api/sites/preview` returns the entry resolved for it plus
`locales` status. Preview URLs append `&locale=<code>`.

## Manifest (`areca.config.ts`)

```ts
defineSiteContent({
  siteKey: 'acme',
  languages: { main: 'nl', all: ['nl', 'en', 'fr'] },
  i18n: { paraglide: './src/paraglide/runtime.js' },   // optional, SDK-only (codegen)
  collections: {
    vacancies: {
      route: '/vacancies/$slug',
      routes: { nl: '/vacatures/$slug' },
      requiredLanguages: ['en'],
      fields: [{ key: 'title', type: 'text', required: true /* translatable defaults on */ }],
    },
  },
})
```

Push applies languages with the same rules as the UI (removal hides,
main change stamps). Omitting `languages` leaves the site's setting alone.

## SDK (`@areca-cms/site-sdk`)

```ts
createContent({ schema, globalSchema, dir, locale?: string | (() => string | undefined) })

content.vacancies.all({ locale?, fallback?: boolean /* default true */, where, orderBy, ... })
content.vacancies.get(slug, { locale?, fallback? })  // matches the locale's slug; falls back to main slug
content.in(locale)               // scoped view, same shape incl. globals/resolve/href/preview
content.languages                // { main, all } | null
content.matchLocale(input)       // negotiation per the fallback chain

entry.locale      // language actually served
entry.isFallback  // true when served from the chain, not the request
entry.locales     // available (complete) languages
entry.alternates  // Record<Locale, href> for collections with a route (per-language slug + pattern)
content.globals.homePage.$locale / .$isFallback   // globals: $-prefixed meta, values stay flat

seoHead(entry.seo, { locale, alternates })   // adds hreflang + og:locale(:alternate)
```

- Resolution order for the active locale: per-call `locale` → `in()` scope →
  `createContent({ locale })` resolver → main.
- `where`/`orderBy` run against the resolved language view.
- `areca.gen.ts`: `export type Locale = 'nl' | 'en' | 'fr'`; `Register`
  gains `languages`; when `i18n.paraglide` is set the generated `content` is
  created with `locale: getLocale` imported from that runtime.
- `areca pull` reads `project.inlang/settings.json` if present and warns on
  `baseLocale`/`locales` mismatch with the CMS languages.

## MCP

- `get_site_info`: `languages: { main, all, names }`, per collection/section
  `requiredLanguages` and translatable field keys.
- `get_entry` / `get_global`: `locale?`. Without it: main-language values plus
  `translations: { <locale>: { complete, missing[] } }`. With it: that
  language's view.
- `create_entry`, `update_entry`, `update_global`: `locale?` (default main);
  `fields`, `seo`, `slug` apply to that language. Shared fields written with
  a non-main locale are applied to the shared value and reported as such.
- `list_entries`: `missingLanguage?`.
- `mark_ready` / `schedule_entry` errors name missing languages.
- `upsert_collection` / `upsert_global`: `translatable` on fields,
  `requiredLanguages`, `routes`.
- New agency tool `set_site_languages({ main, all })` with the same rules.
- `update_asset_alt`: `locale?`.
- `get_preview_url`: `locale?`.

## CMS UI

Single-language sites see none of this.

- **Site settings → Languages** (agency): add languages from a searchable
  list (names via `Intl.DisplayNames`, endonyms like "Nederlands"; free BCP 47
  entry), drag to reorder, "Main language" radio, remove with type-to-confirm.
  Changing main opens a confirm with the gap count.
- **Schema editor sheet**: "Translatable" switch per field (with the type
  default); collection/section "Required languages" chips (main locked on);
  collections get "Translate URL path" with a pattern per language.
- **Entry + section editor**:
  - Language bar directly under the top bar, sticky with it, `role=tablist`,
    one tab per language in site order: endonym, "Main" marker on the main
    language, and a status glyph: complete (check), partial ("2 missing"),
    not started (empty ring), with required languages that aren't complete
    shown in the warning tone. Active tab uses the accent with a `layoutId`
    indicator. Keyboard: arrow keys within the bar; `Alt+Shift+←/→` anywhere
    in the editor.
  - Selected language in `?lang=`; remembered per site in localStorage.
  - Non-main language: a slim context row "Editing English. Shared fields
    change every language." with "Translate empty fields from Nederlands".
    Every translatable field shows the main-language value underneath as a
    muted reference (rich text as 2-line plain-text excerpt, expandable) with
    Copy and Translate actions. Shared fields show a "Same in all languages"
    marker and stay editable.
  - Details panel: slug and SEO follow the selected language (placeholder =
    main slug). Status block lists each language's completeness.
  - Mark ready disabled with the reason ("Add English to mark ready: Title,
    Body"); the reason links to that language.
  - Mobile: the bar scrolls horizontally, showing codes + glyphs.
- **Entry list**: coverage chips (NL EN FR: filled / partial / empty) per row;
  "Missing translation" filter.
- **Library**: alt text per language in the asset detail.
- All new UI strings go through `apps/cms/scripts/i18n-add.mjs` (en/nl/tr).
