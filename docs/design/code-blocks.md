# Code in rich text

Blog posts need inline code and fenced code blocks with a language. This note
records the design decisions behind the feature.

Status: implemented. This is the design note written before the feature was built; the code and the [docs site](https://docs.arecacms.com) are the source of truth where they differ.

## Starting point

- `codeBlock` already exists: StarterKit node, block menu entry (⌘⌥C), allowed
  by `server/richtext/allowlist.ts`, exported as a Markdown fence with
  `attrs.language`, rendered by TanStack Markdown as
  `<pre class="tm-code" data-lang="…"><code class="language-…">`. There is no
  UI to set the language and no syntax colouring anywhere.
- Inline code is off: `code: false` in `server/richtext/extensions.ts`, `code`
  is not in `ALLOWED_MARK_TYPES`, and `from-markdown.ts` flattens
  `inlineCode` to plain text.

## Decisions

1. **Inline `code` mark.** Enabled in the editor, the allowlist, Markdown
   import/export, published `html` and SDK types. Format bar button, selection
   bubble, ⌘E, and the `` `text` `` input rule. It may combine with `link`
   only (no bold or italic inside code).
2. **Language list.** Stored in the existing `codeBlock.attrs.language` as
   `@tanstack/highlight` ids. Supported list (only these are registered, to
   keep the editor bundle small):

   | id | label |
   | --- | --- |
   | `plaintext` | Plain text (default; stored as no language) |
   | `ts` | TypeScript |
   | `tsx` | TSX |
   | `js` | JavaScript |
   | `jsx` | JSX |
   | `html` | HTML |
   | `css` | CSS |
   | `json` | JSON |
   | `shell` | Shell |
   | `python` | Python |
   | `php` | PHP |
   | `sql` | SQL |
   | `yaml` | YAML |
   | `markdown` | Markdown |
   | `go` | Go |
   | `rust` | Rust |
   | `diff` | Diff |

   Aliases (`bash`, `sh`, `typescript`, `javascript`, `yml`, `py`, `md`, …) are
   normalised to these ids on Markdown import, paste and the ```` ```lang ````
   input rule. An unknown language is kept verbatim, saved without error and
   rendered without colours; the picker shows it as is.
3. **Published `html` carries highlight classes.** `renderRichTextHtml` passes
   a `createTanStackMarkdownHighlighter(highlighter)` from
   `@tanstack/highlight/markdown` to TanStack Markdown, so each code block's
   tokens are `<span class="th-token th-<kind>">` (`th-token` on every token,
   the second class names its kind, e.g. `th-keyword`, `th-string`). Inline
   `code` is published as a plain `<code>`, not highlighted. No colours or
   inline styles are published: sites choose a theme in CSS. `markdown` and
   `document` are unchanged.
4. **Existing content.** Markdown import maps `` `x` `` to the `code` mark and
   fences to `codeBlock` with a normalised language. Paste keeps `<code>` and
   `<pre><code class="language-x">`. No migration of content that was already
   imported with inline code flattened.
5. **Translation never touches code.** AI translation sends code blocks and
   inline code to the model as opaque placeholders and restores them verbatim
   (comments inside code included).
6. **Editor highlighting.** Code blocks are coloured live with ProseMirror
   decorations, using the same registered highlighter (one shared isomorphic
   module, e.g. `src/lib/highlight.ts`). Only changed code blocks are
   re-tokenised.
7. **Code block controls.** A language button in the top-right corner of each
   code block (Plex Mono, muted, always visible) opens a searchable list. No
   line numbers, copy button, highlighted lines or file name in this round.
8. **Keyboard.** Tab inserts 2 spaces, Shift+Tab removes up to 2 leading
   spaces on the current lines. Enter is a newline; triple Enter or ArrowDown on
   the last line exits (Tiptap default). ```` ```ts ```` + space at the start of
   a line creates a code block with that language.
9. **Look.** Inline code keeps the base style (subtle background, 6px radius,
   0.875em Plex Mono). Code blocks: a slightly recessed surface (darker than the
   page in dark mode, a touch greyer in light), hairline border, 13px/1.6 Plex
   Mono, horizontal scroll, no wrapping. Token colours from the brand: keyword
   = iris accent, comment = muted foreground, plus two quiet supporting hues for
   strings and numbers/literals/types, AA contrast in light and dark. All via
   CSS variables in `styles.css`, no hard-coded hex in components.
10. **Agents.** MCP server instructions, tool/schema text and the skills guide
    say rich text accepts `` `inline code` `` and fenced blocks with a language,
    list the 17 ids, and tell agents to put code in fences rather than prose.
    Reading an entry back gives the same fences and backticks (lossless round
    trip). An unknown language from an agent saves and returns a warning naming
    the supported ids.
11. **Site builders.** No new SDK dependency or export. The docs app
    (`apps/docs/content/docs/sdk/rich-text.mdx`) and `skills/areca-sdk` get a
    recipe: `pnpm add @tanstack/highlight`, then
    `createThemeCss({ light: githubLightTheme, dark: githubDarkTheme, codeBlockSelector: '.tm-code' })`
    (exports from `@tanstack/highlight/theme` and `@tanstack/highlight/themes/*`)
    or custom CSS for the `th-*` classes; sites rendering `document` themselves
    use `createTanStackMarkdownHighlighter`.
