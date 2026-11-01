# Field formats, SEO, limits and errors

## Field values (write → read)

| Type | Write | Read back |
| --- | --- | --- |
| `text` | Plain text, up to 1,000 chars | same |
| `textarea` | Plain text with line breaks, up to 50,000 chars, no Markdown | same |
| `richtext` | Markdown string (see below): at most 200,000 text chars, 20,000 nodes, depth 32 | Markdown |
| `image` | asset id from `list_assets` / `upload_asset_from_url` | `{ assetId, url, alt }` or `null` |
| `reference` | entry id from `list_entries` of the referenced collection | `{ entryId }` or `null` |
| `date` | `YYYY-MM-DD` | same |
| `datetime` | ISO 8601 with offset, e.g. `2026-10-10T09:00:00+02:00` | same |
| `select` | one listed option, spelled exactly | same |
| `slug` | `a-z`, `0-9` and `-`, unique in the collection, up to 200 chars | same |
| `boolean` / `number` / `url` | `true`/`false` / JSON number / absolute http(s) URL | same |

Unknown field keys are refused, and the error lists the valid ones. Entry data is limited to 1 MB.

**Clearing on update:** use `""` for fields and SEO text, `false` for `noindex`/`nofollow`, `[]` for `keyTakeaways`/`faq`/`about`, and an empty `name` for `author`. Don't use `null`: fields accept it, but `seo` rejects it. A key you leave out keeps its value.

## Site content (globals)

A section has the same field types as a collection, except `slug`. Its fields can set `group`, a heading shown above the field in the CMS editor (not in the data). Collection fields cannot set `group`. A section stores one set of values, so there is no create and no list: read it with `get_global` and change it with `update_global`. `seo` is only accepted on a section that has SEO turned on; `get_global` shows whether it does. `get_global` returns `previewAvailable: true` only when the section has a `previewPath` and the site has a production URL.

## Rich text Markdown

- Use `##` for sections and `###` or `####` for subsections. Other heading levels are clamped.
- Separate paragraphs with a blank line. `**bold**`, `*italic*`, `[link](https://…)`, lists, `>` quotes and tables all work.
- Images: `![alt text](asset:<assetId>)`. The asset must be in this client's Library. Read-back keeps the `asset:` form, so the text can be sent again as is.
- Inline code goes in backticks, such as `` `parse()` `` or `` `--force` ``. It is saved as inline code and read back the same way.
- Code, commands, file contents and config go in fenced blocks with a language: a fence named `ts`, `shell`, `json` and so on. Read-back keeps the fences, so the text can be sent again as is. Never paste code as plain paragraphs.
- Language ids: `ts`, `tsx`, `js`, `jsx`, `html`, `css`, `json`, `shell`, `python`, `php`, `sql`, `yaml`, `markdown`, `go`, `rust`, `diff`, `plaintext`. Aliases such as `bash`, `sh`, `typescript` and `py` are stored as their id (`shell`, `ts`, `python`). A fence with no language is plain text. An unknown language is saved as written and shown without colours. The result lists a warning that names the supported ids, so fix the fence name if you meant one of them.
- Never send HTML: it is not rendered, and the tags end up as visible text. A full https image URL is copied into the Library on save; if the copy fails it stays external and the result lists it in `warnings`. Uploaded assets are still better, because you set their alt text.

## SEO object (`seo` on create/update)

| Key | Limit | Guidance |
| --- | --- | --- |
| `title` | 300 | aim for 50-60 chars |
| `description` | 1,000 | aim for 140-160 chars |
| `focusKeyphrase` | 200 | the search phrase the entry targets |
| `summary` | 2,000 | 2-3 sentences that answer the main question |
| `keyTakeaways` | 12 × 500 | 3-5 self-contained points |
| `faq` | 20 × `{question (500), answer (3,000)}` | only questions the body really answers |
| `ogImage` | asset id | share image, ideally 1200×630 |
| `ogTitle`, `ogDescription` | 300 / 1,000 | fall back to title and description |
| `canonicalUrl` | URL | only when the page duplicates another URL |
| `noindex`, `nofollow` | boolean | |
| `twitterCard` | `summary_large_image` or `summary` | |
| `schemaType` | `Article`, `BlogPosting`, `NewsArticle` or `WebPage` | |
| `about` | 12 × `{name, sameAs?}` | entities the entry is about |
| `author` | `{name, url?, bio?}` | |
| `jsonLd` | 20,000 chars of JSON | usually leave unset, because the CMS builds the main node |

Unknown SEO keys are refused. There is no SEO-generation tool, so you write these values yourself.

## Uploads

`upload_asset_from_url` accepts JPEG, PNG, WebP, GIF and PDF (detected from the bytes) up to 20 MB. URLs must be public `http`/`https` on ports 80, 443, 8080 or 8443, with no credentials. Private and loopback addresses are refused, and there is a 15 s timeout with at most 3 redirects. Use a direct file link, not an HTML page.

## Errors

| Message starts with | Do |
| --- | --- |
| `Validation failed.` | Call `get_collection_schema`, fix the listed fields, retry |
| `This entry changed since you last read it` | Call `get_entry`, reapply the change, retry with the new `version` |
| slug message | Pick another unique slug |
| `This asset is still used by N item(s)` | Remove it from those items first |
| `Could not import the file:` | Ask the user for a direct, public file link |
| `Only site owners…` / `Going live…` / `Only agency admins…` | Tell the user who can do it, e.g. an owner presses Go live in the CMS |
| `No entry with id…` (or asset/job/publication) | Use the list tools to find valid ids |
| `No collection "…" on this site` | Use one of the listed keys (see `get_site_info`). Site content keys are not collections: use `get_global`. |
| `No site content "…" on this site` | Use one of the `globals` keys from `get_site_info`. Disabled sections are not listed to editors and owners. |
| `… has no SEO` | The section has SEO off, so drop `seo`. Ask an agency admin to turn SEO on if it is needed. |
| `… has no preview page` | Preview needs a `previewPath` on the section. An agency admin sets it. |
| `Something went wrong on the Areca server (ref …)` | Nothing is confirmed saved. Retry once, then report the ref. |

HTTP: `401` = token or key invalid, expired, revoked or for another site, so reconnect. `403 mfa_required` = the agency admin must enable 2FA. `429` = wait `Retry-After` seconds (120/min per credential, plus 600/min per client IP when the CMS trusts its proxy).
