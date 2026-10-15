# Multilingual sites (SDK)

Read this when the CMS site has content languages. `get_site_info` in the MCP server, or `content.languages` in the SDK, tells you: `content.languages` is `null` on a single-language site, and then the `locale` options, `entry.locale` and the `Locale` type do not apply.

## Configure the languages

```ts
// areca.config.ts
import { defineSiteContent } from "@areca-cms/site-sdk";

export default defineSiteContent({
  siteKey: "acme",
  languages: { main: "en", all: ["en", "nl"] },
  i18n: { paraglide: "./src/paraglide/runtime.js" },
  collections: {
    articles: {
      route: "/journal/$slug",
      routes: { nl: "/journaal/$slug" },
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "slug", label: "Slug", type: "slug", required: true },
        { key: "price", label: "Price", type: "number", translatable: false },
      ],
    },
  },
  globals: {
    homePage: { label: "Home page", requiredLanguages: ["nl"], fields: [/* ... */] },
  },
});
```

- `languages.main` is the fallback and the language of shared values. `languages.all` is the switcher order and includes `main`. Validation fails on duplicates, a `main` that is not in `all`, or an empty `all`.
- `routes` maps a language to its route pattern. Keys must be in `languages.all`, and each pattern must contain `$slug`. Languages not listed use `route`. The pattern has no language prefix; the site adds it.
- `requiredLanguages` on a collection or global lists the languages (other than main) that must be complete before an entry is marked ready. Every key must be in `languages.all`.
- `translatable` on a field overrides the default. Text, textarea, richtext and url are per language by default; every other type is shared across languages.
- `i18n.paraglide` is the Paraglide runtime path. When it is set, `areca pull` wires its `getLocale` into the generated content object.
- `languages` and the per-language settings are sent with the schema by `manifest push`. `i18n` and `assets` stay local.
- `areca pull` warns when `project.inlang/settings.json` disagrees with `languages`.

The generated `areca.gen.ts` exports `languages` (`{ main, all }`) and the `Locale` union, which is registered for the typed API. Commit it like any other generated file.

## Quick start with Paraglide

1. `pnpm add @inlang/paraglide-js`, with `project.inlang/settings.json` listing the same `locales` as `languages.all`.
2. Add the Vite plugin with `strategy: ['url', 'baseLocale']`, so the locale comes from the URL prefix only.
3. Compile before anything imports the generated content: `paraglide-js compile --project ./project.inlang --outdir ./src/paraglide`. Then run `areca pull`.
4. Wrap the server entry in `paraglideMiddleware`, so server rendering and prerendering see the URL's language.
5. Localize the router's URLs with `deLocalizeUrl` and `localizeUrl` in `createRouter({ rewrite })`. Routes are written once in the main language.
6. `content.articles.all()` now returns the language of the current URL. Use `getLocale()` for `Intl` formatting.

Prerender every language's tree. Each entry's `alternates` gives its path in each language.

## Other i18n libraries

`areca pull` wires only Paraglide. For anything else, build your own content object from the generated schema and pass a resolver:

```ts
// src/content.ts
import { createContent } from "@areca-cms/site-sdk/content";
import { schema, globalSchema } from "./generated/content/areca.gen.ts";
import i18next from "i18next";

export const content = createContent({
  schema,
  globalSchema,
  dir: "src/generated/content",
  locale: () => i18next.resolvedLanguage, // called on every read; undefined = main language
});
```

`createContent({ locale })` takes a string or a function. A function is called on each read, so it follows the library's current language. Use `i18n.global.locale.value` for vue-i18n, or `i18n.locale` from `@lingui/core` for Lingui.

On a server with a per-request language (for example next-intl), do not rely on a global resolver. Pass the request's language per call: `content.in(locale).articles.all()` or `content.articles.all({ locale })`.

## How the language is chosen

For each read, the first of these that is set wins:

1. the `locale` in the call: `all({ locale })`, `get(slug, { locale })`, `byId(id, { locale })`;
2. the scope from `content.in(locale)`;
3. the resolver from `createContent({ locale })`;
4. the main language.

`content.in(locale)` returns a new content object that reads in that language. A per-call `locale` still overrides the scope.

## Reading in a language

Every entry carries:

| Field | Meaning |
| --- | --- |
| `entry.locale` | The language of `data`, `slug` and `seo`. |
| `entry.isFallback` | `true` when it is served in a language other than the one asked for. |
| `entry.locales` | The languages with a complete translation of this entry. |
| `entry.alternates` | The entry's URL in each of `locales`, from its per-language slug and route, for example `{ en: "/journal/backend", nl: "/journaal/backend" }`. |

`content.languages` is `{ main, all }` or `null`. Section values (`content.globals`) carry `$locale` and `$isFallback` instead, and their other values stay flat.

```ts
const dutch = content.in("nl");
const posts = dutch.articles.all({ orderBy: { title: "asc" } });

// Only entries that really exist in Dutch
const onlyDutch = content.articles.all({ locale: "nl", fallback: false });

const post = content.articles.get("backend-ontwikkelaar", { locale: "nl" });
if (post?.isFallback) {
  // show the main-language text with a note, or link to the English page
}
```

- `fallback` defaults to `true`. With `false`, `all` leaves out entries with no complete translation in the requested language, and `get` returns `undefined` for them.
- `where` and `orderBy` run on the language's own values, so a Dutch title sorts by the Dutch title.
- For a requested language, the entry is served from the first complete language of this chain: the exact tag (case-insensitive), its language subtag (`nl-BE` gives `nl`), the main language, then the first complete language in site order.

Use `LocaleOptions` (`{ locale?: Locale; fallback?: boolean }`) to type your own wrappers around these calls.

## Match the visitor's language

```ts
content.matchLocale("nl-BE");                                 // "nl"
content.matchLocale("de;q=0.9, en-GB;q=0.8");                 // "en"
content.matchLocale(request.headers.get("accept-language"));  // main language when nothing matches
```

`content.matchLocale(input)` tries each tag in preference order, first as an exact match and then by its subtag. `Accept-Language` headers are sorted by quality. It returns the main language when nothing matches, and `undefined` on a single-language site. The pure function `matchLocale(input, languages)` from `@areca-cms/site-sdk` takes the languages explicitly, which is useful in a redirect or in a resolver.

## Alternate links and hreflang

Pass the entry's alternates and language to `seoHead` (or `seoHeadHtml`):

```ts
import { seoHead } from "@areca-cms/site-sdk";

export const head = ({ entry }) =>
  seoHead(entry.seo, {
    locale: entry.locale,
    alternates: entry.alternates,
    main: content.languages?.main,
  });
```

- `locale` sets `og:locale`, using `ogLocale(tag)` from `@areca-cms/site-sdk/seo`: `nl` stays `nl`, `nl-BE` becomes `nl_BE`.
- Each alternate becomes a `hreflang` link and an `og:locale:alternate`. The page's own locale is included as a link but not as an `og:locale:alternate`.
- `main` makes the main language's alternate also the `x-default` link.
- Relative alternate paths are made absolute from the site origin when the entry has a canonical URL.
- For pages that aren't entries, build the same alternates from the path in each language.
- Set the document's `lang` attribute to the page's language.

## Preview in a language

The CMS opens preview links with `&locale=<code>`. Pass it through:

```ts
const result = await content.preview(token, { locale: url.searchParams.get("locale") ?? undefined });
// or without the content object:
const raw = await getPreviewEntry({ token, locale: "nl" });
```

- `content.previewGlobals(source, { locale })` takes the same option for sections.
- `client.fetchPreview(token, { locale })` sends the same query parameter.
- A preview draft carries `localeStatus`: a map from each site language to `PreviewLocaleStatus` (`{ complete, missing }`, where `missing` lists the labels of the missing required fields). `PreviewSnapshotEntry` and `PreviewSnapshotGlobal` are the preview types that include it. Use it to show an incomplete draft in the language it was written in.
- Preview responses are draft content. Send `previewHeaders()` (`X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`) and keep them out of caches and search.

## Checklist

- `languages` in `areca.config.ts` matches the CMS site and `project.inlang/settings.json`.
- `routes` for each language use the same segments as the router's localized URLs.
- Shared values (prices, contact details, product names) are `translatable: false`.
- Pages prerender in every language and link to their alternates.
- Untranslated entries either fall back with a note or are left out with `fallback: false`.
- Preview routes read `locale` from the query string and send `previewHeaders()`.
