# Links in rich text

Editors and AI apps need to link to other pages of the same site: by path, to
another entry, and to a section of another entry. Links must keep working in
every language and when a slug, a domain or a heading changes. This note
records the design decisions behind the feature.

Status: planned (5 stacked PRs). The code and the [docs site](https://docs.arecacms.com) become the source of truth once each part is merged.

## Starting point

- Rich text is stored as TipTap JSON. A link is the mark
  `{ type: 'link', attrs: { href } }`.
- `isAllowedLinkHref` (`server/richtext/allowlist.ts`) accepts only absolute
  `http:`/`https:` URLs with a host and `mailto:`. `/path` and `#anchor` are
  rejected.
- Markdown import (`server/richtext/from-markdown.ts`) silently drops a
  rejected link and keeps its text. No warning reaches the MCP caller.
- The editor link popover (`features/editor/rich-text/rich-text-editor.tsx`,
  `applyLink`) prefixes `https://` to anything without a scheme, so `/coffees/x`
  becomes `https:///coffees/x`, which parses as host `coffees`: a broken link is
  saved.
- `server/richtext/extensions.ts` gives every link `target="_blank"`.
- The snapshot carries `{ json, markdown, document, html }` per rich text value
  (`server/richtext/index.ts`). The SDK rewrites asset URLs at pull time
  (`site-sdk/src/assets.ts`, `mapStrings`).
- Reference fields store the target entry id. The snapshot resolves them to
  `{ collection, slug, id }`; the SDK builds localized paths without a locale
  prefix (`content.href`). Neither the CMS nor the SDK knows the `/nl` prefix:
  each site owns it (demo: `src/lib/locale-routes.ts`).
- Per-locale routes (`routes: { nl: '/journaal/$slug' }`) and per-locale slugs
  (`$i18n.<locale>.$slug`) exist. Rich text is translatable, so every language
  has its own body and its own links.
- `listInboundReferences` only scans top-level reference fields, only for the
  delete dialog. Dev environments remap reference ids on fork and push
  (`server/dev-env/references.ts`).

## Decisions

### Relative links (PR1)

1. **Allowed hrefs.** Besides `http(s)://host…` and `mailto:`, allow:
   - site paths that start with exactly one `/` (`/coffees/x`, `/coffees/x#faq`, `/search?q=a`);
   - in-page anchors that start with `#` (`#faq`).

   Still rejected: protocol-relative `//host`, `/\` and `\` tricks, any
   whitespace or control character, and every other scheme (`javascript:`,
   `data:`, …). Same check in the editor, Markdown import and the save
   validator.
2. **Editor input.** `applyLink` adds `https://` only when the text looks like a
   domain (no scheme, does not start with `/`, `#`, `?` or `.`). `/path` and
   `#anchor` are stored as typed.
3. **Dropped links warn.** When Markdown import has to drop a link, the text is
   kept and a warning names the link, through the existing import-warnings path
   (`withImportWarnings`, like external images).
4. **MCP instructions.** The rich text instruction tells AI apps to link to the
   site's own pages with site paths (`/coffees/slug`) and in-page sections with
   `#anchor`, never with full URLs of the same site.
5. **Same tab for internal links.** External links keep `target="_blank"` and
   `rel="noopener noreferrer"`. Site paths, anchors and (later) entry links get
   no `target` in the editor, the published `html` and the SDK rendering.

### Entry links (PR2, PR3, PR4)

6. **Stored shape.** A link to an entry is the link mark with
   `{ href, entryId, collection, anchor? }`. `href` is the target's main-language
   path at save time, so older SDKs and the Markdown export still produce a
   working link. Validation: `entryId` must be an entry of a routed collection
   of the same site, `anchor` must be a valid fragment id.
7. **Targets.** Entries of collections with a route only. Site content sections
   (globals) cannot be targets yet: they have one `previewPath` and no address
   per language. They can be sources (their rich text may link to entries).
8. **Resolution at Go live.** The snapshot replaces each entry link's `href`
   with the target's path in the language of the text: the locale route
   (`routes[locale] ?? route`) with the locale slug, falling back to the main
   language when the target has no translation, plus `#anchor`. This applies to
   `json`, `document`, `html` and `markdown`.
9. **Locale prefix in the SDK.** New optional `i18n.localizePath(path, locale)`
   in `areca.config.ts`. `areca pull` applies it to every resolved entry link.
   Default: the main language gets no prefix, other languages get `/<locale>`.
   The demo site uses the default.
10. **Target not live.** A link whose target is not in the release (draft,
    archived, deleted) is published as plain text and listed as a warning in the
    Go live panel. It never blocks the release. Linking to a draft is allowed;
    if both go live in the same release the link works.
11. **Preview.** Draft previews resolve entry links to the target's current
    draft path, so clicking around the preview works.
12. **Typed paths become entry links.** In the editor and in Markdown import, a
    site path or a full URL on the site's production domain that matches an
    entry route is stored as an entry link (with `anchor` from `#…`). Paths that
    match nothing stay plain relative links.
13. **Editor popover: one smart field.** No tabs. One input with suggestions
    under it:
    - Matching entries of all routed collections (title, collection, status
      badge Draft / Ready / Live), searched by title and slug in the language
      being edited. `/…` searches by address, `#…` lists the headings of the
      entry being edited, and a pasted URL on the site's own domain matches its
      entry. The title and slug of a language are its `readLocale` view (the
      base values for the base language, else its translation), the same for
      the row and for the search.
    - When nothing matches, one row "Custom link: …" (with `https://` added when
      needed). Plain words show it only when no entry matches; an address, a
      path or a URL always keeps it last.
    - Preselection: input that looks like an address (contains a dot, a scheme,
      `mailto:`, starts with `/` or `#`) preselects the custom link; plain words
      preselect the best matching entry. Enter takes the preselected row; arrow
      keys and the mouse pick any row.
    - After picking an entry, an optional *Section* field lists that entry's
      headings in the language being edited (or a custom anchor). Typing
      `ethiopia#` jumps straight to the sections of the best match.
    - An empty field shows the 5 most recently edited entries.
    - An existing link opens as a chip (entry title and badge, or the custom
      URL); typing replaces it, Remove removes it.
14. **Dead links in the editor.** Links whose target is archived or deleted, or
    whose section no longer exists, get a red dashed underline and a hint.
15. **Markdown and MCP.** Import accepts `[text](entry:<id>)`,
    `[text](entry:<id>#anchor)` and site paths or same-domain URLs (decision 12).
    Markdown sent back to AI apps writes entry links as `entry:<id>[#anchor]`.
    Instructions and `get_site_info` explain both forms.
16. **Anchors.** Section ids are computed with the same heading slug function
    as `@tanstack/markdown`, so they match sites that render rich text with the
    SDK helpers. A section that no longer exists produces a Go live warning and
    the link goes to the page itself.
17. **Dev environments.** Entry links follow the same id mapping as reference
    fields on fork and push. A link whose target cannot exist in production
    becomes plain text and is listed in the push warnings.

### Links between entries (PR2, PR5)

18. **Link index.** A table of `(site, source entry, locale, target entry,
    anchor)` rows, rewritten when an entry or section is saved, deleted or
    pushed. It powers the delete warning, the rename dialog and "Linked from".
19. **Delete warning.** The delete dialog lists entries whose rich text links to
    the entry, next to reference fields. Warn only, as today.
20. **"Linked from".** The editor side panel lists the entries and sections
    that link to the entry, per language and section.
21. **Renaming a heading.** When a save changes or removes a heading that links
    point to, a dialog lists those links (entry, language, status) with *Update
    all links* or *Keep as is*. A heading at the same position with new text is a
    rename; a removed heading lets the editor pick another section or the page.
    Only entries the user may edit are updated; the rest are listed for an
    owner. Updated entries keep their status (the change is mechanical) and
    their history records "Section link updated by …".
22. **MCP rename.** `update_entry` returns a warning naming the entries whose
    links point to a section that no longer exists, so the AI can update them.

### Releases, docs and skills

23. `@areca-cms/site-sdk` gets a minor version with a changelog entry (PR2).
24. The docs site covers linking for editors, `localizePath` and the snapshot
    shape for developers, and entry links for AI apps.
25. `@areca-cms/skills`, the MCP instructions and `AGENTS.md` describe the new
    link model.

## PR stack

| PR | Scope |
| --- | --- |
| 1 | Decisions 1–5 |
| 2 | Decisions 6–11, 16–19, 23, SDK docs and skills |
| 3 | Decisions 12–14, editor docs |
| 4 | Decisions 12 and 15 for MCP and Markdown, MCP docs |
| 5 | Decisions 20–22 |
