# Multilingual sites

A site can publish in several languages. A site with one language behaves as described in the rest of the skill, and none of the `locale`, `translations`, `missingLanguage` or `translatable` parameters appear. Use this file only when `get_site_info` returns `languages`.

## Languages and the main language

`get_site_info` returns `languages`:

```json
{ "main": "nl", "all": ["nl", "en"], "names": { "nl": "Dutch", "en": "English" } }
```

- `main` is the fallback. Visitors get it when a translation is missing, and it holds the shared base values.
- `all` is the display order and always includes `main`.
- Codes are BCP 47 (`nl`, `en`, `nl-BE`). Use the exact code from `all` in `locale`.

`set_site_languages({ main, all })` changes them. Agency admins only.

| Parameter | Behaviour |
| --- | --- |
| `main` | Required. Must be one of `all`. |
| `all` | Required. Every language, in display order, including `main`. At least one, at most the site limit. |

- Removing a language hides it: it stops shipping and leaves the editor, but its text stays in the entries and comes back if you add the language again.
- A site cannot go back to having no languages. To go back to one language, set `all` to the single code (the rest are hidden as above).
- Changing `main` deletes nothing. Entries and sections that are not complete in the new main language cannot be marked ready until they are. The result's `gaps` counts them, and the message says how many.

## Writing one language per call

`create_entry`, `update_entry`, `update_global` and `update_asset_alt` take `locale`. Leave it out for the main language.

- `fields`, `seo` and `slug` apply to the language you name. A translation's `slug` is that language's own URL. Send `""` to fall back to the main slug.
- Fields that are not translatable are shared. Changing one in any language changes it in every language, and the response lists them in `sharedFieldsUpdated`. Check that list before you assume a write stayed in one language.
- By default `text`, `textarea`, `richtext` and `url` fields are per language. Other types (number, date, image, reference, select and so on) are shared. `get_collection_schema` shows `translatable` for each field, and `get_site_info` lists `translatableFields` per collection and section.

`update_entry` only changes the keys you send. Pass `expectedVersion` from `get_entry` as usual.

## Checking translations

`get_entry` without `locale` returns the main language's values plus `translations`:

```json
"translations": {
  "en": { "complete": false, "missing": ["fields.summary"] }
}
```

- `complete` is true when every required field has a value in that language.
- `missing` lists the required fields that are empty there.
- With `locale`, `get_entry` returns that language's values (slug and seo included) instead, and no `translations`.

`list_entries({ collection, missingLanguage: "en" })` returns only entries whose draft is not complete in that language.

`get_global({ global, locale })` and `get_preview_url({ id, locale })` work the same way. A preview link with `locale` opens that language's page.

## Required languages

Each collection and section can require languages to be complete before it is marked ready. Set them with `requiredLanguages` (for example `["en"]`) on `upsert_collection` or `upsert_global`, or in `areca.config.ts`. `get_site_info` shows the current list per collection.

`mark_ready` and `schedule_entry` refuse an entry until every required language is complete. The error names the languages and the fields that are missing. Fill them in with `update_entry` and `locale`, then mark ready again. Only when the user asks.

## Per-language routes

`upsert_collection` also takes `routes`, a route pattern per language, each with `$slug`. For example `{"nl": "/vacatures/$slug"}`. Languages that are not listed use `routePattern`. Patterns do not contain the language prefix, because the site adds it. Send `{}` to remove them all.

`routes` and `requiredLanguages` are ignored on a site without languages. For a site that syncs its schema from code, put these in `areca.config.ts` and push with `areca manifest push` rather than calling `upsert_collection`.

## Translating with AI

There is no MCP tool for AI translation. The CMS editor's language bar offers "translate with AI", which fills empty fields from the main language. An agent that is asked to translate writes each language itself with `update_entry` and `locale`.

## Multilingual workflow

1. `get_site_info`: read `languages` (main and `all`), and each collection's `requiredLanguages` and `translatableFields`.
2. `get_collection_schema({ collection })`: check which fields are `translatable`, and use the `translation` example if the response has one.
3. `create_entry` or `update_entry` for the main language, with no `locale`.
4. For each other language, one `update_entry({ id, locale, fields, seo, slug, expectedVersion })` call. Read `sharedFieldsUpdated` in each response.
5. `get_entry({ id })` and check `translations`. Fill any missing required field, then repeat until every language is `complete`.
6. Show the user the `previewUrl`, or call `get_preview_url({ id, locale })` to check one language. Mark ready only when the user asks.

## Errors

- `This site has one language, so locale does not apply. Leave it out.`: remove `locale` from the call.
- `"xx" is not one of this site's languages (...)`: the error lists the codes the site has. Use one of them, or call `get_site_info`.
- `Only agency admins can change the site languages.`: tell the user an agency admin must change them.
- A mark-ready refusal for incomplete languages: fill in the named languages and fields, then retry.
