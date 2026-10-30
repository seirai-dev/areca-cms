# Click to edit: field() markers

## What field() returns

```ts
import { field, type VisualFieldAttributes } from "@areca-cms/site-sdk/visual";

field("title");                          // { "data-areca-field": "title" }
field("name", { entry: "e_123" });       // { "data-areca-field": "name", "data-areca-entry": "e_123" }
field("email", { global: "companyInfo" }); // { "data-areca-field": "email", "data-areca-global": "companyInfo" }
```

- Spread the object on the element that shows the value. In templates without spread, write the attributes by hand: `data-areca-field="title"`.
- `field()` throws `TypeError: field(): the key must be 1-200 characters` for an empty or longer key, at render time.
- It does no checking or conversion. The CMS maps the key when the page reports it.
- `VisualFieldAttributes` types the result.

## Keys

The CMS matches a marker's key against the fields of the entry or section, in this order:

1. The exact CMS field key (`hero_image`).
2. `seo.<name>` means `$seo.<name>`.
3. The camelCase form of a CMS key (`heroImage` for `hero_image`). This is the name the code sees in `entry.data`, so either form works.

A key that matches nothing is ignored, and the element acts as if it had no marker. Nothing reports the mistake, so check spelling against `areca.config.ts`.

SEO keys (for entries, and for sections with `seo: true`): `$seo.title`, `$seo.description`, `$seo.focusKeyphrase`, `$seo.ogTitle`, `$seo.ogDescription`, `$seo.ogImage`, `$seo.summary`, `$seo.keyTakeaways`, `$seo.faq`, `$seo.about`, `$seo.author`, `$seo.canonicalUrl`, `$seo.jsonLd`. Mark the visible SEO blocks (summary, key takeaways, FAQ) so editors can reach them from the page.

There are no nested paths. A key is always one top-level field. To make a part of a field clickable, mark the element that holds the whole field:

| Field type | Where the marker goes |
| --- | --- |
| text, textarea, number, date, url | The element showing the value (`<h1>`, `<p>`, `<time>`, `<a>`). |
| richtext | The wrapper around the rendered body. Clicking anywhere in it opens the field. |
| image | The `<img>` (or the `<figure>` around it). |
| select, boolean | The element that shows the result (a badge, a pill, a "Limited" label). |
| reference | The referenced entry's own fields, with `{ entry: ref.id }` (below). Mark the reference field itself (`field("author")`) only where the page shows something that changes when the editor picks another target, such as a "Written by" block. |
| list-like values (tags, tasting notes) | The list element (`<ul>`), not each item. |

Several elements can carry the same marker (a title in the header and in the body). All of them outline together, and the CMS scrolls to the first one when the editor focuses the field.

## Owners

The owner says whose field it is.

| Owner | Use it for |
| --- | --- |
| none | A field of the entry (or section) this preview is about. |
| `{ entry: id }` | A field of another entry: a referenced author, a featured product card, a related post. `id` is `entry.id`, not the slug. |
| `{ global: key }` | A field of a site content section: footer company details, header navigation, a banner. `key` is the section key, raw or camelCase. |

```tsx
const owner = { entry: author.id };
<img {...field("portrait", owner)} src={author.data.portrait?.url} alt={author.data.portrait?.alt ?? ""} />
<span {...field("name", owner)}>{author.data.name}</span>
```

- The CMS checks every owner on the server before it outlines anything. An owner passes when it belongs to this site, is not archived or deleted, and is in a section or collection the current user may edit. Failed owners are not outlined and clicks on them work as normal page clicks.
- A click on another owner's field opens a "This is part of …" popover. "Open in visual editor" saves the current entry, then opens the owner in Visual mode.
- On a site content page, the section's own fields can use no owner or `{ global: "<this section>" }`; both count as the page's own.
- Pass exactly one of `entry` or `global`. `{ entry, global }` is rejected by the bridge, and `field()` would silently keep only `entry`.
- An owner id longer than 200 characters, or empty, makes the overlay drop the marker without a message.

## Gating: markers on preview pages only

Public HTML must not contain `data-areca-*` attributes. `field()` itself is not gated. Gate it once, near the root, and make components call the gated function.

- React: a context that holds `field` on preview pages and `() => ({})` elsewhere (`VisualMarkers` and `useField` in [react.md](react.md)). Enable it on the `__preview` route and when the URL has a non-empty `arecaPreview`.
- Templates: pass a `markers` boolean down, or a function `mark(key, owner)` that returns `""` on public pages.
- Turn markers on for the whole layout of a preview page, so the header and footer mark their site content fields too.

The CMS shows outlines only for markers it lists as targets, so stray markers do no harm inside the editor. The rule is about public pages: they should not ship editing hooks or reveal entry ids.

## What the overlay does

The bridge draws the overlay itself. The site adds nothing and cannot style it.

- It lives in a shadow root on `<div data-areca-visual="overlay">` at the end of `<html>`, fixed, full screen, `pointer-events: none`, at the top z-index. A `<style data-areca-visual="style">` in `<head>` sets `cursor: pointer` on the hovered element, which carries `data-areca-visual-hover` while hovered. Don't remove these nodes, and keep site CSS from targeting them.
- It scans the DOM for `[data-areca-field]` 100 ms after changes (a `MutationObserver` on the field, entry and global attributes and on content), and reports up to 500 markers. Live re-renders, client navigation and swapped HTML are picked up without any call.
- **Select mode** (the default): a click on a target is cancelled and reported to the CMS, and a form submit from inside a target is blocked. Clicks anywhere else work normally, so links, menus and forms without markers keep working. A marked link opens its field instead of navigating.
- **Browse mode**, or holding Option/Alt, lets every click through.
- When the editor focuses a field in the CMS, the overlay outlines its elements and scrolls the first one into view if it is off screen.
- Esc in the page is forwarded to the CMS to leave full screen. The key press is not cancelled.

## Limits

- Field keys, owner ids and labels: 200 characters each.
- 500 markers per page. Above that the list is capped, and the CMS ignores the rest. Mark sections and lists rather than every repeated item on very long pages.
- One iframe level: the bridge must run in the page the CMS frames, not in a frame inside it.
