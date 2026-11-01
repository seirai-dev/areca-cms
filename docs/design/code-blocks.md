# Code in rich text

Blog posts need inline code and fenced code blocks with a language. This spec
records the decisions from the 1 Nov 2026 grilling session and splits the
work into three stacked PRs.

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
   `@tanstack/highlight/markdown` to TanStack Markdown, so code spans get
   `token …` classes. No colours or inline styles are published: sites choose a
   theme in CSS. `markdown` and `document` are unchanged.
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
    `createThemeCss({ light: githubLight, dark: githubDark, codeBlockSelector: '.tm-code' })`
    or custom CSS for the token classes; sites rendering `document` themselves
    use `createTanStackMarkdownHighlighter`.

## PR stack

Branch base: `feat/code-blocks-rich-editor` (off `main`).

### PR 1 — Content format (`feat/code-blocks-format`)

- `pnpm add @tanstack/highlight` in `apps/cms`.
- `src/lib/highlight.ts`: shared highlighter with the 17 languages, the
  language list (id + label), and `normalizeCodeLanguage(raw)` returning a
  supported id, `undefined` for plain text, or the raw string when unknown.
- `server/richtext/extensions.ts`: enable `code` (excludes bold/italic, allows
  link); `allowlist.ts`: add `code` mark.
- `from-markdown.ts`: `inlineCode` → text with `code` mark (plus link when
  nested); fence language normalised.
- `markdown.ts` / `from-json.ts`: inline code serialised with a backtick run
  that cannot close inside the text; links around code survive.
- `document.ts`: highlighted `html` via the TanStack Markdown adapter.
- `server/ai/translate.ts`: protect code with placeholders and restore.
- Validation warning for unknown code languages where MCP writes are converted
  (`server/mcp/entry-format.ts`), surfaced in the existing warnings list.
- Tests: round-trip and fidelity tests, highlighted html snapshot, translation
  placeholder test, alias normalisation.

### PR 2 — Editor (`feat/code-blocks-editor`)

- Inline code: format bar button, bubble button, ⌘E, tooltip/menu labels via
  paraglide messages (all locales the app ships).
- Code block extension (extend StarterKit's `codeBlock`): language attr parse
  from `language-*` class with normalisation, ```` ```lang ```` input rule,
  Tab/Shift+Tab, highlight decoration plugin, React node view or overlay for the
  language button + searchable list (reuse existing popover / command
  primitives).
- Styles in `styles.css` for code block surface, language button and token
  colours, light and dark.
- e2e: inline code via ⌘E, set language, code survives save and reload.
- Screenshots shown to the user before opening the PR.

### PR 3 — Agents and docs (`feat/code-blocks-agents-docs`)

- `server/mcp/server.ts`, `server/mcp/agency-server.ts`,
  `server/mcp/schemas.ts`, `server/mcp/tools/*`: rich text format text with
  inline code and a ```` ```ts ```` example, the id list, and the "code goes in
  fences" rule; keep agency/site parity tests passing.
- `skills/areca-mcp/references/content.md` (+ SKILL.md if needed),
  `skills/areca-sdk`: format and highlight recipe; drift tests updated.
- `apps/docs/content/docs/sdk/rich-text.mdx`: highlighting recipe.
