# 06 Brand, design tokens and tooling (research for apps/docs)

Scope: read-only research on `/Users/ek/development/projects/areca-cms`. No repo files were edited. Sources: `docs/DESIGN.md`, `docs/design/brief.md`, `apps/cms/src/styles.css`, `apps/cms/src/lib/branding.ts`, `apps/cms/src/components/brand-mark.tsx`, the package manifests, Dockerfile, compose and CI workflows.

## 0. Read this first: which visual direction is current

- `apps/cms/src/styles.css` is **unmodified** against HEAD (`git status` clean for that file). It is the iris + Inter system described below.
- `docs/DESIGN.md` and `docs/design/brief.md` are modified in the working tree but still describe the iris + Inter system ("Inter everywhere", "Bricolage dropped from the default look").
- The user's auto-memory (`areca-cms-tanstack-ds-2026-09-18.md`, `areca-cms-visual-direction.md`) describes **later or earlier directions that do not exist in the repo**: a TanStack DS token set (`ds-neutral` bone/olive, `ds-green` brand `#39af46`, Bricolage headings + Inter body + Plex Mono), flat pages with hairline rules and no card grids, and an earlier ink/paper/clay/moss/fern palette. A grep of the repo for `39af46`, `ds-green`, `bone`, `tanstack.com/ds` found nothing. The memory file says it "supersedes" the redesign, but the code does not reflect it.
- **Action for the docs site:** confirm with the user which palette is canonical before copying values. The values below are the ones actually in the code. "Flat rules, not cards" is the user's stated preference in memory; the repo's `Card` still uses a hairline border plus `shadow-card`.

## 1. Visual identity

### 1.1 Philosophy (docs/DESIGN.md §1, brief §0)

- Calm by default: warm neutral canvas, white surfaces with 1px hairline borders, near-zero shadows. Colour carries meaning and is never decoration.
- Light and dark are equal first-class token sets.
- Four UX tests: newcomer, grandparent, one-primary-button, whisper (secondary info quiet).
- Sentence case, no exclamation marks. Ink is the one primary button colour; accent (iris) marks selection, focus, links, switches, progress and "Ready".
- Components never hard-code colours; everything goes through tokens.
- Theme is a class on `<html>` (`next-themes`, `defaultTheme="system"`, storage key `areca.theme`).

### 1.2 Colour tokens, verbatim from `apps/cms/src/styles.css`

Light (`@theme`, lines 28-95 are colour and font variables; repeated verbatim in `:root, .light` at lines 371-439):

```css
  /* Neutrals */
  --color-background-default: #f6f6f4;
  --color-background-surface: #ffffff;
  --color-background-elevated: #ffffff;
  --color-background-subtle: #efefec;
  --color-background-inverse: #1d1d1f;
  --color-sidebar: #fbfbfa;
  --color-scrim: rgb(20 20 22 / 0.28);

  --color-text-primary: #1d1d1f;
  --color-text-secondary: #5e5e63;
  --color-text-muted: #8a8a8e;
  --color-text-disabled: #b8b8bc;
  --color-text-inverse: #ffffff;
  --color-text-accent: #4b49c4;
  --color-text-success: #177a42;
  --color-text-warning: #955900;
  --color-text-error: #c0271d;

  --color-border-default: rgb(0 0 0 / 0.08);
  --color-border-strong: rgb(0 0 0 / 0.14);
  --color-border-subtle: rgb(0 0 0 / 0.05);
  --color-border-focus: #5856d6;
  --color-border-error: #d93025;

  --color-icon-default: #5e5e63;
  --color-icon-accent: #5856d6;
  --color-icon-muted: #8a8a8e;
  --color-icon-success: #1f9d55;
  --color-icon-warning: #c77700;
  --color-icon-error: #d93025;

  /* Ink: the primary button */
  --color-action-primary: #1d1d1f;
  --color-action-primary-hover: #3a3a3d;
  --color-action-primary-text: #ffffff;
  --color-action-secondary: #efefec;
  --color-action-secondary-hover: #e6e6e2;
  --color-action-destructive: #d93025;
  --color-action-destructive-hover: #c0271d;

  /* Accent: iris (Apple systemIndigo). Instance branding re-tints these. */
  --color-accent: #5856d6;
  --color-accent-hover: #4b49c9;
  --color-accent-soft: rgb(88 86 214 / 0.12);
  --color-accent-text: #4b49c4;
  --color-accent-contrast: #ffffff;

  /* Status */
  --color-status-success: #1f9d55;
  --color-status-success-bg: rgb(31 157 85 / 0.12);
  --color-status-warning: #c77700;
  --color-status-warning-bg: rgb(199 119 0 / 0.12);
  --color-status-error: #d93025;
  --color-status-error-bg: rgb(217 48 37 / 0.1);
  --color-status-info: #5856d6;
  --color-status-info-bg: rgb(88 86 214 / 0.12);
  --color-status-neutral: #8a8a8e;
  --color-status-neutral-bg: rgb(0 0 0 / 0.05);

  --color-surface-state-hover: rgb(0 0 0 / 0.04);
  --color-surface-state-pressed: rgb(0 0 0 / 0.07);

  /* Segmented controls (Apple's systemFill) */
  --color-segment-track: rgb(118 118 128 / 0.12);
  --color-segment-thumb: #ffffff;
  --color-segment-edge: rgb(0 0 0 / 0.05);

```

Dark (`html.dark, .dark`, lines 297-366, verbatim):

```css
html.dark,
.dark {
  --color-background-default: #0e0e10;
  --color-background-surface: #18181b;
  --color-background-elevated: #1f1f23;
  --color-background-subtle: #232327;
  --color-background-inverse: #f5f5f7;
  --color-sidebar: #131315;
  --color-scrim: rgb(0 0 0 / 0.55);

  --color-text-primary: #f5f5f7;
  --color-text-secondary: #aeaeb2;
  --color-text-muted: #7c7c80;
  --color-text-disabled: #4f4f54;
  --color-text-inverse: #111111;
  --color-text-accent: #a5a3ff;
  --color-text-success: #5fd394;
  --color-text-warning: #ffb340;
  --color-text-error: #ff7b72;

  --color-border-default: rgb(255 255 255 / 0.08);
  --color-border-strong: rgb(255 255 255 / 0.16);
  --color-border-subtle: rgb(255 255 255 / 0.05);
  --color-border-focus: #7d7aff;
  --color-border-error: #ff6961;

  --color-icon-default: #aeaeb2;
  --color-icon-accent: #8f8cff;
  --color-icon-muted: #7c7c80;
  --color-icon-success: #34c77b;
  --color-icon-warning: #ff9f0a;
  --color-icon-error: #ff6961;

  --color-action-primary: #f5f5f7;
  --color-action-primary-hover: #e3e3e8;
  --color-action-primary-text: #111111;
  --color-action-secondary: #2a2a2e;
  --color-action-secondary-hover: #333338;
  --color-action-destructive: #ff6961;
  --color-action-destructive-hover: #ff7f78;

  --color-accent: #7d7aff;
  --color-accent-hover: #9391ff;
  --color-accent-soft: rgb(125 122 255 / 0.16);
  --color-accent-text: #a5a3ff;
  --color-accent-contrast: #ffffff;

  --color-status-success: #34c77b;
  --color-status-success-bg: rgb(52 199 123 / 0.14);
  --color-status-warning: #ff9f0a;
  --color-status-warning-bg: rgb(255 159 10 / 0.14);
  --color-status-error: #ff6961;
  --color-status-error-bg: rgb(255 105 97 / 0.14);
  --color-status-info: #7d7aff;
  --color-status-info-bg: rgb(125 122 255 / 0.16);
  --color-status-neutral: #7c7c80;
  --color-status-neutral-bg: rgb(255 255 255 / 0.06);

  --color-surface-state-hover: rgb(255 255 255 / 0.05);
  --color-surface-state-pressed: rgb(255 255 255 / 0.08);
  --color-segment-track: rgb(118 118 128 / 0.24);
  --color-segment-thumb: #636369;
  --color-segment-edge: rgb(255 255 255 / 0.14);

  --shadow-card: 0 1px 2px rgb(0 0 0 / 0.3);
  --shadow-float:
    0 16px 48px -8px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(255 255 255 / 0.04);
  --shadow-raise: 0 8px 24px -8px rgb(0 0 0 / 0.5);

  color-scheme: dark;
```

Shape and depth variables (`@theme`, lines 102-113, verbatim):

```css

  /* Shape */
  --radius-control: 10px;
  --radius-card: 16px;
  --radius-panel: 20px;
  --radius-thumb: 10px;

  /* Depth */
  --shadow-card: 0 1px 2px rgb(0 0 0 / 0.04);
  --shadow-float: 0 12px 40px -8px rgb(0 0 0 / 0.18);
  --shadow-raise: 0 8px 24px -8px rgb(0 0 0 / 0.14);
  --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px 0 rgb(0 0 0 / 0.03);
```

Layout and z-scale variables (`:root`, lines 442-455, verbatim):

```css
:root {
  /* Layout. Desktop has no top bar; the mobile top bar sets its own height. */
  --sidebar-width: 264px;
  --sidebar-rail-width: 64px;
  --navbar-height: 0px;
  --content-max: 1120px;
  /* Z scale. Nothing else may set a z-index. */
  --z-navbar: 100;
  --z-floating: 400;
  --z-scrim: 999;
  --z-overlay: 1000;
  --z-above-overlay: 1200;
}

```

Rules for the tokens (DESIGN.md §2): ink (`action-primary`) is the only primary-button colour. Accent is iris, `#5856D6` light and `#7D7AFF` dark, with a 12-16% soft fill. Dark mode uses the `#0E0E10` canvas, `#18181B` surface, `#1F1F23` elevated, `#232327` subtle.

### 1.3 Fonts and how they are loaded

- Inter Variable, `@fontsource-variable/inter` 5.3.0, imported in `styles.css` as `@import '@fontsource-variable/inter/opsz.css';` (optical-size axis, so display sizes get Inter Display cuts). Body uses `font-feature-settings: 'cv11' 1, 'ss03' 1;` and `-webkit-font-smoothing: antialiased`.
- Bricolage Grotesque Variable, `@fontsource-variable/bricolage-grotesque` 5.3.0, `opsz.css`. Not the default in the iris system; it is selectable in Branding only. Note: `--font-display` is `var(--font-sans)` (Inter), so headings are Inter by default.
- IBM Plex Mono, `@fontsource/ibm-plex-mono` 5.3.0, imported as `400.css` and `500.css`. Used for slugs, ids, hashes, logs, code.
- Other branding presets (DM Sans, Manrope, Figtree, IBM Plex Sans, ...) load at runtime from Google Fonts CSS2 via `fontStylesheetUrl()` in `apps/cms/src/lib/branding.ts` (`https://fonts.googleapis.com/css2?family=...&display=swap`).
- `h1` to `h6` use `font-family: var(--font-display)`, `text-wrap: balance`.

### 1.4 Type scale (styles.css `@utility` blocks, lines 467-540)

| Class | Family | Size/line | Weight | Tracking |
| --- | --- | --- | --- | --- |
| `text-display` | sans | 32/38 | 650 | -0.022em |
| `text-title-1` | sans | 24/30 | 600 | -0.018em |
| `text-title-2` | sans | 19/26 | 600 | -0.012em |
| `text-headline` | sans | 15/22 | 600 | -0.006em |
| `text-body` | sans | 14/20 | 400 | -0.003em |
| `text-body-lg` | sans | 17/28 | 400 | -0.008em |
| `text-callout` | sans | 13/18 | 400 | none |
| `text-caption` | sans | 12/16 | 500 | none |
| `text-overline` | sans | 11/14 | 600 | +0.06em, uppercase |
| `text-mono` | mono | 12/16 | 400 | none |
| `text-editor-title` | sans | 40/48 | 700 | -0.025em |

Body default: 14px / 20px.

### 1.5 Radii, spacing, borders, depth

- Radius: `--radius-control` 10px (buttons, inputs), `--radius-card` 16px, `--radius-panel` 20px (outer corners of sheets), `--radius-thumb` 10px. Pills and avatars use `rounded-full`.
- Spacing: 4-based. Page gutter 32px desktop / 16px mobile. Content max 1120px (`--content-max`). Card padding 20px. Inset rows 52-60px tall with 16px padding.
- Control heights (DESIGN.md §4.3 / brief): 36px default, 30px small, 28px xs, 44px large. Touch targets at least 44px on coarse pointers (`touch-target` utility).
- Borders: 1px hairlines at `rgb(0 0 0 / 0.08)` light and `rgb(255 255 255 / 0.08)` dark. Strong 14% / 16%.
- Depth: `--shadow-card` `0 1px 2px rgb(0 0 0 / 0.04)` (light), `--shadow-float` `0 12px 40px -8px rgb(0 0 0 / 0.18)`, `--shadow-raise` `0 8px 24px -8px rgb(0 0 0 / 0.14)`.
- Utilities `surface-card` (16px radius, hairline, surface bg, card shadow) and `surface-float` (hairline, elevated bg, float shadow) at styles.css lines 561-573.
- Z scale: `--z-navbar` 100, `--z-floating` 400, `--z-scrim` 999, `--z-overlay` 1000, `--z-above-overlay` 1200. Nothing else sets z-index.

### 1.6 Icons

- Phosphor, `@phosphor-icons/react` 2.1.10. Regular weight, 18px in navigation, 16px inline. The active nav item uses `fill` weight in accent.
- Collection icon heuristic (`collectionIcon` in `apps/cms/src/lib/site-nav.ts`): article/blog/post → Article; page → File; job/vacanc → Briefcase; event → Calendar; product → Tag; team/person → User; fallback → Stack.
- The brief said Lucide was removed in the (unrepo'd) TanStack pass; Phosphor is the only icon set in the repo.

### 1.7 Motion

- Library: `motion` 13.4.0 (`motion/react`). Presets in `apps/cms/src/lib/motion.ts`: `SPRING_PANEL` spring 420/36/mass 0.9 (sheets, panels); `SPRING_SMALL` spring 520/40 (pills, tiles); `FADE` 150ms standard ease (reduced-motion fallback).
- CSS: `--ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1)`, `--ease-emphasized: cubic-bezier(0.32, 0.72, 0, 1)`. Durations `--motion-duration-fast` 150ms, `--motion-duration-base` 180ms, `--motion-duration-sheet` 280ms.
- Page enter: 180ms fade plus 4px rise (`.page-enter`, `enter-rise` keyframes). View transitions: 180ms root crossfade; shared elements via `view-transition-name`.
- Staggered reveals: 30ms per item, cap 10, opacity plus 6px y.
- Nothing above ~250ms perceived. Reduced motion: every animation collapses to instant or a fade; global `prefers-reduced-motion` CSS backstop in styles.css.

### 1.8 Logo and wordmark assets

- `apps/cms/public/favicon.svg` (250 bytes): 32x32 rounded square (rx 8) filled `#5856D6` with a white leaf-like path. This is the Areca mark.
- `apps/cms/public/drizzle.svg`: the Drizzle ORM logo, not Areca. Do not reuse.
- No wordmark SVG or PNG exists in the repo. There is no `logo*` file anywhere outside `node_modules`.
- The default logo is not an image: `apps/cms/src/components/brand-mark.tsx` renders a Phosphor `Leaf` (`weight="fill"`, 18px) inside an accent-filled tile (`bg-accent text-accent-contrast`, 36px, 10px radius; sm 28px/8px, lg 48px/14px). The app name is plain text (`branding.appName`) next to it, 15px semibold.
- Per-instance logo and favicon are uploads in Agency > Branding (`apps/cms/src/features/agency/branding-screen.tsx`, `/api/admin/branding/upload`), applied to `<head>` in `apps/cms/src/routes/__root.tsx` (line ~64).
- For apps/docs: the favicon SVG above can be copied as an asset file (it is a static asset, not shared code). Recreate the Leaf glyph from Phosphor if a standalone logo tile is needed.

## 2. Tooling versions

### 2.1 Root `package.json` (name `areca`, private)

- Scripts run via `pnpm --filter @areca/cms ...`; `build` is `pnpm -r build`; `test` is `pnpm -r test`.
- devDependencies: `@playwright/test` ^1.63.0, `eslint` ^10.10.0, `prettier` ^3.9.6, `typescript` ^6.0.3, `vitest` ^5.0.1.
- No `packageManager` field. No `engines` field.

### 2.2 `apps/cms/package.json` (`@areca/cms`, type module)

Key runtime versions (ranges as declared; installed value from `apps/cms/node_modules`):

- React `^19.3.0` (installed 19.3.0), react-dom same.
- TanStack Start `@tanstack/react-start` `^1.168.60` (installed 1.168.60). Router `@tanstack/react-router` `^1.170.41` (installed 1.170.41). Also `@tanstack/react-router-ssr-query` ^1.167.3, `@tanstack/react-query` ^5.104.0, `@tanstack/router-cli` ^1.167.36 (dev), `@tanstack/devtools-vite` 0.8.5 (dev).
- Vite `^8.3.0` (dev; installed 8.3.0). `@vitejs/plugin-react` ^6.1.1 (dev).
- Tailwind `tailwindcss` `^4.3.3` and `@tailwindcss/vite` `^4.3.3` (installed 4.3.3). `@tailwindcss/typography` ^0.5.20 (dev). `tw-animate-css` ^1.4.0.
- TypeScript `^6.0.3` (installed 6.0.3). Node types `@types/node` ^22.20.2.
- `@tanstack/markdown` `^1.0.0` (installed 1.0.0).
- `motion` ^13.4.0 (installed 13.4.0). `@phosphor-icons/react` ^2.1.10. `next-themes` ^0.4.6. `radix-ui` ^1.6.7. `cmdk` ^1.1.1. `sonner` ^2.0.8. `class-variance-authority` ^0.7.1.
- Fonts: `@fontsource-variable/inter` ^5.3.0, `@fontsource-variable/bricolage-grotesque` ^5.3.0, `@fontsource/ibm-plex-mono` ^5.3.0.
- Tiptap ^3.31.3 (rich text editor). Drizzle ORM ^0.45.2, drizzle-kit ^0.31.10. better-auth ^1.7.5. `nitro` pinned to `3.0.260903-beta` (exact prerelease).
- Test/lint dev: `vitest` ^5.0.1, `@playwright/test` ^1.63.0, `eslint` ^10.10.0, `prettier` ^3.9.6, `@tanstack/eslint-config` 0.4.0, `tsx` ^4.23.13, `esbuild` ^0.28.2, `@inlang/paraglide-js` ^2.25.2 (i18n).
- `"intent": { "skills": ["*"] }` is set, so all skills are exposed for @tanstack/intent.

### 2.3 `packages/site-sdk/package.json` (`@areca-cms/site-sdk` 0.2.0)

- `engines.node` `>=22.6.0`. `"type": "module"`, exports `.`, `./pull`, `./rich-text`, `./seo`. Bin `areca`.
- Deps: `@tanstack/markdown` `0.0.15` (exact, not a caret range; installed 0.0.15), `@clack/prompts` ^1.8.1.
- Dev: `typescript` ^6.0.3, `vitest` ^5.0.1, `@types/node` ^24.13.4.
- Note the version split: CMS uses `@tanstack/markdown` 1.0.0; the SDK uses 0.0.15. The demo site (`examples/demo-site`) also has 0.0.15 and react-start 1.168.54.

### 2.4 `@tanstack/markdown` usage in the CMS

- `apps/cms/src/server/richtext/document.ts`: `parseMarkdown` from `@tanstack/markdown/parser` and `renderHtml` from `@tanstack/markdown/html`. Converts stored markdown to a `MarkdownDocument` AST and to static HTML on the server.
- `apps/cms/src/features/editor/rich-text/rich-text-preview.tsx`: `Markdown` and `MarkdownComponents` from `@tanstack/markdown/react`, for the editor's Preview mode.
- Types only: `MarkdownDocument` in `apps/cms/src/lib/types.ts`, `apps/cms/src/server/richtext/index.ts`, `packages/site-sdk/src/types.ts`.
- `packages/site-sdk/src/rich-text.ts`: `parseMarkdown` for site consumers. The SDK docs say sites render `html` (static) or use `@tanstack/markdown/react`.
- Implication for apps/docs: write docs in markdown and render with `@tanstack/markdown` (or the same `parser`/`react` entry points) to match the CMS output if docs share rich text with the CMS. Otherwise any markdown pipeline works. Pinning matters: 1.0.0 vs 0.0.15 have different APIs.

### 2.5 Node, pnpm, lint and format

- Node: no `.nvmrc`, no `.node-version`, no `engines` in the CMS. Dockerfile `ARG NODE_VERSION=24.21.0` (`node:${NODE_VERSION}-alpine`), CI `NODE_VERSION: 24.21.0`. Local `node -v` is v24.21.0.
- pnpm: no `packageManager` field. Dockerfile `ARG PNPM_VERSION=12.8.1` (`npm install --global pnpm@${PNPM_VERSION}`), CI `PNPM_VERSION: 12.8.1`. Local `pnpm -v` is 12.4.1 (behind the pin, so use `npm i -g pnpm@12.8.1` or `corepack` to match).
- Lockfile: `pnpm-lock.yaml` `lockfileVersion: '9.0'`.
- Prettier: `apps/cms/prettier.config.js` `{ semi: false, singleQuote: true, trailingComma: "all" }`. `.prettierignore` lists lock files only. Root has prettier 3.9.6 as devDep but no root config (the root has none).
- ESLint: `apps/cms/eslint.config.js` flat config spreading `tanstackConfig` from `@tanstack/eslint-config` 0.4.0, with `import/no-cycle`, `import/order`, `sort-imports`, `@typescript-eslint/array-type`, `@typescript-eslint/require-await` and `pnpm/json-enforce-catalog` turned off. Ignores `src/paraglide/**` and `.output/**`.
- Format: `pnpm --filter @areca/cms format` (prettier --write, then eslint --fix); `check` is `prettier --check .`.
- TypeScript: `apps/cms/tsconfig.json` and `packages/site-sdk/tsconfig.json`. Root `tsconfig.json` also exists.

### 2.6 `pnpm-workspace.yaml`

- `packages`: `apps/*`, `packages/*`, `examples/*`, `*`.
- `allowBuilds` (postinstall/build scripts permitted): `esbuild`, `lightningcss`, `better-sqlite3`, `unrs-resolver`, `sharp` set to `true`; `'@openrouter/sdk': false`. A new dependency that needs a build script (native binary, postinstall) is **blocked** until it is added here.
- `minimumReleaseAgeExclude`: lists exact versions of `@tanstack/markdown@1.0.0`, `@tanstack/react-router@1.170.41`, `@tanstack/react-start@1.168.60`, and several more `@tanstack/*` packages (start/router core, router-generator/plugin, start-plugin-core, start-storage-context, etc.). These are the TanStack packages allowed to install before the release-age cooldown elapses.
- No `minimumReleaseAge` key is set in this file. The exclude list only has effect if a release-age gate is active, which it probably is through pnpm defaults or user config. Verify with `pnpm config get minimum-release-age` (or check `~/.npmrc`) before relying on it. Practical implication: a brand-new package version may refuse to install; if so, add it to `minimumReleaseAgeExclude` with an exact version.
- `overrides`: `"@esbuild-kit/core-utils>esbuild": 0.25.12`.
- `catalog` is not used in this file (the eslint rule for catalogs is disabled).
- Root `.npmrc`: none. `apps/cms/.npmrc`: none.

## 3. Deployment (CMS)

- **Image build:** `apps/cms/Dockerfile`, built from the repo root (`docker build -f apps/cms/Dockerfile .`). Multi-stage on `node:24.21.0-alpine`: `base` (WORKDIR /app), `deps` (installs pnpm 12.8.1 globally, copies `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` and `apps/cms/package.json`, then `pnpm install --filter @areca/cms --no-include-workspace-root --frozen-lockfile` with a BuildKit cache mount `cms-pnpm`), `build` (copies `apps/cms`, `SKIP_ENV_VALIDATION=true`, `pnpm --filter @areca/cms build`, then `scripts/build-docker-entrypoint.mjs`), `runner` (copies only `.output`, `.docker/docker-entrypoint.mjs`, and `drizzle`; runs as `node`; `PORT=3000`, `HOST=0.0.0.0`; HEALTHCHECK fetches `/api/health` every 30s; `CMD ["node", "scripts/docker-entrypoint.mjs"]`).
- **Dockerignore:** `apps/cms/Dockerfile.dockerignore` denies everything (`**`), then re-allows only the root manifests, `apps/`, `apps/cms/`. Excludes `.env*`, `.output`, `.nitro`, `.tanstack`, `dist`, `src/paraglide`, `src/generated`.
- **CI:** `.github/workflows/ci.yml` (on PR, push to main, and `workflow_call`) runs site-sdk typecheck/test/build, CMS typecheck and tests, script tests, docker recovery tests, demo-site typecheck/test, plus a secret scan and client bundle scan. `cms-docker-amd64.yml` (push to main) calls CI, then builds and pushes `ghcr.io/<repo lowercased>` tagged `sha-<commit>` and `latest` (via `docker/build-push-action` v7.4.0). `cms-docker-arm64.yml` builds ARM64 on `ubuntu-24.04-arm`; a manifest step uses `docker buildx imagetools create`.
- **Compose (demo/self-host):** `docker/compose.yml` (project name `areca-demo`). Services: `cms` (image `${CMS_IMAGE:-ghcr.io/seirai-dev/areca-cms:latest}`, port `127.0.0.1:${CMS_PORT:-3000}:3000`, `init: true`, required env `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY`, `S3_SECRET_KEY`), `postgres:17-alpine`, `redis:8-alpine` (AOF on), `rustfs/rustfs:1.0.0` (S3, port 9001 on localhost), `axllent/mailpit:v1.31.3` (SMTP 1025, UI 8025 on localhost). Named volumes for postgres, redis, rustfs. Start with `docker compose up -d --wait` from `docker/`. Env template: `docker/.env.example`.
- **Docker README pins:** `docker/README.md` says the Dockerfile pins Node 24.21.0 and pnpm 12.8.1 "latest as of 2026-10-01"; override with `--build-arg NODE_VERSION=...`, `PNPM_VERSION=...`.
- **Dokploy:** Dokploy (v0.29.12 per `docs/DEPLOYMENT.md`) is used to host **customer sites**, not the CMS. `apps/cms/scripts/dokploy-setup.ts` (run via `pnpm --filter @areca/cms dokploy:setup`, env from `.env.local`) registers a Dokploy application that clones the monorepo over SSH (`GIT_URL`, `SSH_KEY_ID`), builds the site Dockerfile, and passes the site token as a BuildKit secret. Dokploy API auth is header `x-api-key`. No Dokploy config exists for the CMS itself in the repo (no `dokploy.json`, no compose labels).
- **Mirror for apps/docs (suggested):** a standalone `apps/docs/Dockerfile` in the same pattern (node 24.21.0-alpine, pnpm 12.8.1, `--frozen-lockfile`, `pnpm --filter <docs> build`, serve the static output or a Node runtime on port 3000, non-root `node` user, HEALTHCHECK). Build with `docker build -f apps/docs/Dockerfile .` from the root. Publish to `ghcr.io/<owner>/<repo>-docs` from a separate workflow triggered on `apps/docs/**`. Its own `Dockerfile.dockerignore` keeps the context small. Keep it free of imports from `apps/cms` or `packages/*`.

## 4. Skill check: `pnpm dlx @tanstack/intent@latest list` (run from repo root)

Exit code 0. Output verbatim (`pnpm dlx` ran without error; 12 intent-enabled packages, 51 skills; the lines after the header are the full skill tree):

```text

12 intent-enabled packages, 51 skills

PACKAGE                          SOURCE  VERSION   SKILLS  
───────────────────────────────────────────────────────────
@tanstack/ai                     local   0.65.1    12      
@tanstack/devtools-vite          local   0.8.5     1       
@tanstack/markdown               local   1.0.0     6       
@tanstack/react-start            local   1.168.60  3       
dotenv                           local   17.4.2    2       
@tanstack/router-core            local   1.171.34  10      
@tanstack/start-client-core      local   1.170.34  7       
@tanstack/virtual-file-routes    local   1.162.0   1       
@tanstack/router-plugin          local   1.168.42  1       
@tanstack/start-server-core      local   1.169.39  1       
@tanstack/devtools-event-client  local   0.5.0     3       
@tanstack/devtools               local   0.15.0    4       

Version conflicts:

  @tanstack/markdown -> using 1.0.0
    chosen: /Users/ek/development/projects/areca-cms/apps/cms/node_modules/@tanstack/markdown
    also found: 0.0.15 at /Users/ek/development/projects/areca-cms/examples/demo-site/node_modules/@tanstack/markdown

  @tanstack/react-start -> using 1.168.60
    chosen: /Users/ek/development/projects/areca-cms/apps/cms/node_modules/@tanstack/react-start
    also found: 1.168.54 at /Users/ek/development/projects/areca-cms/examples/demo-site/node_modules/@tanstack/react-start

  @tanstack/router-core -> using 1.171.34
    chosen: /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+router-core@1.171.34/node_modules/@tanstack/router-core
    also found: 1.171.30 at /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+router-core@1.171.30/node_modules/@tanstack/router-core

  @tanstack/start-client-core -> using 1.170.34
    chosen: /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+start-client-core@1.170.34/node_modules/@tanstack/start-client-core
    also found: 1.170.30 at /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+start-client-core@1.170.30/node_modules/@tanstack/start-client-core

  @tanstack/router-plugin -> using 1.168.42
    chosen: /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+router-plugin@1.168.42_@tanstack+react-router@1.170.41_react-dom@19.3.0_react_57da8fa847d1a2aeab54d028dbae709d/node_modules/@tanstack/router-plugin
    also found: 1.168.38 at /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+router-plugin@1.168.38_@tanstack+react-router@1.170.36_react-dom@19.3.0_react_8aa1a55bc1c958632d47a9a3bc20664c/node_modules/@tanstack/router-plugin

  @tanstack/start-server-core -> using 1.169.39
    chosen: /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+start-server-core@1.169.39_crossws@0.4.12_srvx@1.0.5_/node_modules/@tanstack/start-server-core
    also found: 1.169.35 at /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+start-server-core@1.169.35_crossws@0.4.12_srvx@1.0.5_/node_modules/@tanstack/start-server-core

  @tanstack/devtools-event-client -> using 0.5.0
    chosen: /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+devtools-event-client@0.5.0/node_modules/@tanstack/devtools-event-client
    also found: 0.4.4 at /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+devtools-event-client@0.4.4/node_modules/@tanstack/devtools-event-client


Skills:

  @tanstack/ai
    ai-core                       [core]        Entry point for TanStack AI skills. Routes to chat-experience, tool-calling, media-generation, structured-outputs, adapter-configuration, ag-ui-protocol, middleware, locks, custom-backend-integration, and debug-logging, plus the skills shipped by companion packages (@tanstack/ai-persistence, @tanstack/ai-code-mode). Use chat() not streamText(), openaiText() not createOpenAI(), toServerSentEventsResponse() not manual SSE, middleware hooks not onEnd callbacks.
      Load: pnpm exec intent load @tanstack/ai#ai-core
      adapter-configuration       [sub-skill]   Provider adapter selection and configuration: openaiText, anthropicText, geminiText, ollamaText, grokText, groqText, openRouterText, bedrockText, byteplusText, openaiCompatible. Per-model type safety with modelOptions, reasoning/thinking configuration, runtime adapter switching, extendAdapter() for custom models, createModel(). Generic OpenAI-compatible providers (DeepSeek, Together, Fireworks, etc.) via openaiCompatible({ baseURL, apiKey, models }) from @tanstack/ai-openai/compatible. API key env vars: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY/GEMINI_API_KEY, XAI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, OLLAMA_HOST, BEDROCK_API_KEY (or AWS_BEARER_TOKEN_BEDROCK). BytePlus needs TWO keys: ARK_API_KEY (ModelArk — chat/video/image) and BYTEPLUS_VOICE_API_KEY (Seed Speech — TTS/transcription); neither is a fallback for the other.
        Load: pnpm exec intent load @tanstack/ai#ai-core/adapter-configuration
      ag-ui-protocol              [sub-skill]   Server-side AG-UI streaming protocol implementation: StreamChunk event types (RUN_STARTED, TEXT_MESSAGE_START/CONTENT/END, TOOL_CALL_START/ARGS/END, RUN_FINISHED, RUN_ERROR, STEP_STARTED/STEP_FINISHED, STATE_SNAPSHOT/DELTA, CUSTOM), toServerSentEventsStream() for SSE format, toHttpStream() for NDJSON format. For backends serving AG-UI events without client packages.
        Load: pnpm exec intent load @tanstack/ai#ai-core/ag-ui-protocol
      chat-experience             [sub-skill]   End-to-end chat implementation: server endpoint with chat() and toServerSentEventsResponse(), client-side useChat hook with fetchServerSentEvents(), message rendering with UIMessage parts, multimodal content, thinking/reasoning display. Covers streaming states, connection adapters, and message format conversions. NOT Vercel AI SDK — uses chat() not streamText().
        Load: pnpm exec intent load @tanstack/ai#ai-core/chat-experience
      client-persistence          [sub-skill]   Browser chat persistence on useChat / ChatClient: localStoragePersistence, sessionStoragePersistence, indexedDBPersistence. Client-authoritative (adapter, full transcript) vs server-authoritative (persistence: true, no client cache). Reload restore, pending interrupts, mid-stream rejoin with delivery durability. Use for SPA reload durability — NOT server history alone. Also covers generation hooks (useGenerateImage etc.), which take only the server-driven mode: persistence: true hydrates the last generation for the (REQUIRED) threadId from the server on mount and repaints status/result/error, nothing is cached in the browser. No extra package: the adapters ship in the framework packages.
        Load: pnpm exec intent load @tanstack/ai#ai-core/client-persistence
      custom-backend-integration  [composition] Connect useChat to a non-TanStack-AI backend through custom connection adapters. ConnectConnectionAdapter (single async iterable) vs SubscribeConnectionAdapter (separate subscribe/send). Customize fetchServerSentEvents() and fetchHttpStream() with auth headers, custom URLs, and request options. Import from framework package, not @tanstack/ai-client.
        Load: pnpm exec intent load @tanstack/ai#ai-core/custom-backend-integration
      debug-logging               [sub-skill]   Pluggable, category-toggleable debug logging for TanStack AI activities. Toggle with `debug: true | false | DebugConfig` on chat(), summarize(), generateImage(), generateSpeech(), generateTranscription(), generateVideo(). Categories: request, provider, output, middleware, tools, agentLoop, config, errors. Pipe into pino/winston/etc via `debug: { logger }`. Errors log by default even when `debug` is omitted; silence with `debug: false`.
        Load: pnpm exec intent load @tanstack/ai#ai-core/debug-logging
      locks                       [sub-skill]   LockStore, InMemoryLockStore, LocksCapability and withLocks for multi-instance coordination in TanStack AI. Ships in @tanstack/ai — NOT in @tanstack/ai-persistence. Separate from AIPersistence state stores — not a stores key, not composable. InMemoryLockStore vs a distributed (e.g. Cloudflare Durable Object) lock, lease recovery, AbortSignal in critical sections. Use when sandbox or other middleware needs cross-worker mutual exclusion — NOT for storing messages/runs (use withPersistence).
        Load: pnpm exec intent load @tanstack/ai#ai-core/locks
      media-generation            [sub-skill]   Image, audio, video, speech (TTS), and transcription generation using activity-specific adapters: generateImage() with openaiImage/geminiImage/byteplusImage, generateAudio() with geminiAudio/falAudio, generateVideo() with async polling (openaiVideo/geminiVideo/grokVideo/falVideo/byteplusVideo/openRouterVideo, per-model typed durations), generateSpeech() with openaiSpeech/byteplusSpeech/elevenlabsSpeech, generateTranscription() with openaiTranscription/byteplusTranscription, generateVoice() with elevenlabsVoiceDesign (create a voice, then speak with it). React hooks: useGenerateImage, useGenerateAudio, useGenerateSpeech, useTranscription, useGenerateVideo. TanStack Start server function integration with toServerSentEventsResponse.
        Load: pnpm exec intent load @tanstack/ai#ai-core/media-generation
      middleware                  [sub-skill]   Chat lifecycle middleware hooks: onConfig, onStart, onChunk, onBeforeToolCall, onAfterToolCall, onUsage, onFinish, onAbort, onError. Use for analytics, event firing, tool caching (toolCacheMiddleware), logging, and tracing. Middleware array in chat() config, left-to-right execution order. NOT onEnd/onFinish callbacks on chat() — use middleware.
        Load: pnpm exec intent load @tanstack/ai#ai-core/middleware
      structured-outputs          [sub-skill]   Type-safe JSON schema responses from LLMs using outputSchema on chat() and useChat(). Supports Zod, ArkType, and Valibot schemas. The adapter handles provider-specific strategies transparently — never configure structured output at the provider level. Pass stream:true alongside outputSchema for incremental JSON deltas + a completed typed object via the `structured-output.complete` event. Each successfully completed structured-output run adds a typed `StructuredOutputPart` to message history. partial/final derive from the most recent structured-output part after the latest user message. convertSchemaToJsonSchema() for manual schema conversion.
        Load: pnpm exec intent load @tanstack/ai#ai-core/structured-outputs
      tool-calling                [sub-skill]   Isomorphic tool system: toolDefinition() with Zod schemas, .server() and .client() implementations, passing tools to both chat() on server and useChat/clientTools on client, tool approval flows with needsApproval and bound interrupts (resolveInterrupt), generic middleware interrupts with defineInterrupt(), lazy tool discovery with lazy:true, rendering ToolCallPart and ToolResultPart in UI.
        Load: pnpm exec intent load @tanstack/ai#ai-core/tool-calling

  @tanstack/devtools-vite
    devtools-vite-plugin          [core]        Configure @tanstack/devtools-vite for source inspection (data-tsd-source, inspectHotkey, ignore patterns), console piping (client-to-server, server-to-client, levels), enhanced logging, server event bus (port, host, HTTPS), production stripping (removeDevtoolsOnBuild), editor integration (launch-editor, custom editor.open). Must be FIRST plugin in Vite config. Vite ^6 || ^7 only.
      Load: pnpm exec intent load @tanstack/devtools-vite#devtools-vite-plugin

  @tanstack/markdown
    custom-extensions             [core]        Implement MarkdownExtension block and inline source parsers, inline and document transforms, HTML hooks, and portable block and inline component output. Load when adding deterministic custom syntax or rendering behavior across HTML, React, and Octane.
      Load: pnpm exec intent load @tanstack/markdown#custom-extensions
    docs-features                 [core]        Build documentation metadata with docsMarkdownExtensions, GitHub-style callouts, heading collection, comment components, heading/file/package- manager/bundler tabs, framework panels, and code-fence metadata. Load when authoring or consuming TanStack-style docs syntax and custom-element data contracts.
      Load: pnpm exec intent load @tanstack/markdown#docs-features
    octane-rendering              [framework]   Render Markdown source or a MarkdownDocument with @tanstack/markdown/octane using Markdown, renderMarkdownOctane, ComponentBody replacements, TSRX, and octane/server static SSR. Load for Octane descriptors, custom emitted tags, pre-parsed documents, SSR return values, or renderer parity.
      Load: pnpm exec intent load @tanstack/markdown#octane-rendering
    production-pipelines          [lifecycle]   Audit and ship a production Markdown pipeline with explicit trust boundaries, external syntax highlighting, parse-ahead caching, compatibility checks, deterministic output, and bundle budgets. Load before deploying blogs, docs, or untrusted-content rendering.
      Load: pnpm exec intent load @tanstack/markdown#production-pipelines
    react-rendering               [framework]   Render Markdown source or a MarkdownDocument with @tanstack/markdown/react using Markdown, renderMarkdownReact, component replacements, and React static SSR. Load for React article components, emitted-tag mappings, pre-parsed documents, custom elements, or renderer parity.
      Load: pnpm exec intent load @tanstack/markdown#react-rendering
    render-markdown               [core]        Parse Markdown with parseMarkdown or parseInline, render HTML with renderHtml, renderDocument, renderBlock, or renderInline, configure frontmatter and heading IDs, and reuse the serializable MarkdownDocument AST. Load for @tanstack/markdown core syntax, parser options, HTML output, references, footnotes, lists, tables, or AST work.
      Load: pnpm exec intent load @tanstack/markdown#render-markdown

  @tanstack/react-start
    react-start                   [framework]   React bindings for TanStack Start: createStart, StartClient, StartServer, React-specific imports, re-exports from @tanstack/react-router, full project setup with React, useServerFn hook.
      Load: pnpm exec intent load @tanstack/react-start#react-start
      server-components           [sub-skill]   Implement, review, debug, and refactor TanStack Start React Server Components in React 19 apps. Use when tasks mention @tanstack/react-start/rsc, renderServerComponent, createCompositeComponent, CompositeComponent, renderToReadableStream, createFromReadableStream, createFromFetch, Composite Components, React Flight streams, loader or query owned RSC caching, router.invalidate, structuralSharing: false, selective SSR, stale names like renderRsc or .validator, or migration from Next App Router RSC patterns. Do not use for generic SSR or non-TanStack RSC frameworks except brief comparison.
        Load: pnpm exec intent load @tanstack/react-start#react-start/server-components
    lifecycle/migrate-from-nextjs  [lifecycle]   Step-by-step migration from Next.js App Router to TanStack Start: route definition conversion, API mapping, server function conversion from Server Actions, middleware conversion, data fetching pattern changes.
      Load: pnpm exec intent load @tanstack/react-start#lifecycle/migrate-from-nextjs

  dotenv
    dotenv                                      Load environment variables from a .env file into process.env for Node.js applications. Use when configuring apps with secrets, setting up local development environments, managing API keys and database uRLs, parsing .env file contents, or populating environment variables programmatically. Always use this skill when the user mentions .env, even for simple tasks like "set up dotenv" — the skill contains critical gotchas (encrypted keys, variable expansion, command substitution) that prevent common production issues.
      Load: pnpm exec intent load dotenv#dotenv
    dotenvx                                     Use dotenvx to run commands with environment variables, manage multiple .env files, expand variables, and encrypt env files for safe commits and CI/CD.
      Load: pnpm exec intent load dotenv#dotenvx

  @tanstack/router-core
    router-core                   [core]        Framework-agnostic core concepts for TanStack Router: route trees, createRouter, createRoute, createRootRoute, createRootRouteWithContext, addChildren, Register type declaration, route matching, route sorting, file naming conventions. Entry point for all router skills.
      Load: pnpm exec intent load @tanstack/router-core#router-core
      auth-and-guards             [sub-skill]   Route protection with beforeLoad, redirect()/throw redirect(), isRedirect helper, authenticated layout routes (_authenticated), non-redirect auth (inline login), RBAC with roles and permissions, auth provider integration (Auth0, Clerk, Supabase), router context for auth state.
        Load: pnpm exec intent load @tanstack/router-core#router-core/auth-and-guards
      code-splitting              [sub-skill]   Automatic code splitting (autoCodeSplitting), .lazy.tsx convention, createLazyFileRoute, createLazyRoute, lazyRouteComponent, getRouteApi for typed hooks in split files, codeSplitGroupings per-route override, splitBehavior programmatic config, critical vs non-critical properties.
        Load: pnpm exec intent load @tanstack/router-core#router-core/code-splitting
      data-loading                [sub-skill]   Route loader option, loaderDeps for cache keys, staleTime/gcTime/ defaultPreloadStaleTime SWR caching, pendingComponent/pendingMs/ pendingMinMs, errorComponent/onError/onCatch, beforeLoad, router context and createRootRouteWithContext DI pattern, router.invalidate, Await component, deferred data loading with unawaited promises.
        Load: pnpm exec intent load @tanstack/router-core#router-core/data-loading
      navigation                  [sub-skill]   Link component, useNavigate, Navigate component, router.navigate, ToOptions/NavigateOptions/LinkOptions, from/to relative navigation, activeOptions/activeProps, preloading (intent/viewport/render), preloadDelay, navigation blocking (useBlocker, Block), createLink, linkOptions helper, scroll restoration, MatchRoute.
        Load: pnpm exec intent load @tanstack/router-core#router-core/navigation
      not-found-and-errors        [sub-skill]   notFound() function, notFoundComponent, defaultNotFoundComponent, notFoundMode (fuzzy/root), errorComponent, CatchBoundary, CatchNotFound, isNotFound, NotFoundRoute (deprecated), route masking (mask option, createRouteMask, unmaskOnReload).
        Load: pnpm exec intent load @tanstack/router-core#router-core/not-found-and-errors
      path-params                 [sub-skill]   Dynamic path segments ($paramName), splat routes ($ / _splat), optional params ({-$paramName}), prefix/suffix patterns ({$param}.ext), useParams, params.parse/stringify, pathParamsAllowedCharacters, i18n locale patterns.
        Load: pnpm exec intent load @tanstack/router-core#router-core/path-params
      search-params               [sub-skill]   validateSearch, search param validation with Zod/Valibot/ArkType adapters, fallback(), search middlewares (retainSearchParams, stripSearchParams), custom serialization (parseSearch, stringifySearch), search param inheritance, loaderDeps for cache keys, reading and writing search params.
        Load: pnpm exec intent load @tanstack/router-core#router-core/search-params
      ssr                         [sub-skill]   Non-streaming and streaming SSR, RouterClient/RouterServer, renderRouterToString/renderRouterToStream, createRequestHandler, defaultRenderHandler/defaultStreamHandler, HeadContent/Scripts components, head route option (meta/links/styles/scripts), ScriptOnce, automatic loader dehydration/hydration, memory history on server, data serialization, document head management.
        Load: pnpm exec intent load @tanstack/router-core#router-core/ssr
      type-safety                 [sub-skill]   Full type inference philosophy (never cast, never annotate inferred values), Register module declaration, from narrowing on hooks and Link, strict:false for shared components, getRouteApi for code-split typed access, addChildren with object syntax for TS perf, LinkProps and ValidateLinkOptions type utilities, as const satisfies pattern.
        Load: pnpm exec intent load @tanstack/router-core#router-core/type-safety

  @tanstack/start-client-core
    start-core                    [core]        Core overview for TanStack Start: tanstackStart() Vite plugin, getRouter() factory, root route document shell (HeadContent, Scripts, Outlet), client/server entry points, routeTree.gen.ts, tsconfig configuration. Entry point for all Start skills.
      Load: pnpm exec intent load @tanstack/start-client-core#start-core
      auth-server-primitives      [sub-skill]   Server-side authentication primitives for TanStack Start: session cookies (HttpOnly, Secure, SameSite, __Host- prefix), session read/issue/destroy via createServerFn and middleware, OAuth authorization-code flow with state and PKCE, password-reset enumeration defense, CSRF for non-GET RPCs, rate limiting auth endpoints, session rotation on privilege change. Pairs with router-core/auth-and-guards for the routing side.
        Load: pnpm exec intent load @tanstack/start-client-core#start-core/auth-server-primitives
      deployment                  [sub-skill]   Deploy to Cloudflare Workers, Netlify, Vercel, Node.js/Docker, Bun, Railway. Selective SSR (ssr option per route), SPA mode, static prerendering, ISR with Cache-Control headers, SEO and head management.
        Load: pnpm exec intent load @tanstack/start-client-core#start-core/deployment
      execution-model             [sub-skill]   Isomorphic-by-default principle, environment boundary functions (createServerFn, createServerOnlyFn, createClientOnlyFn, createIsomorphicFn), ClientOnly component, useHydrated hook, import protection, dead code elimination, environment variable safety (VITE_ prefix, process.env).
        Load: pnpm exec intent load @tanstack/start-client-core#start-core/execution-model
      middleware                  [sub-skill]   createMiddleware, request middleware (.server only), server function middleware (.client + .server), context passing via next({ context }), sendContext for client-server transfer, global middleware via createStart in src/start.ts, middleware factories, method order enforcement, fetch override precedence.
        Load: pnpm exec intent load @tanstack/start-client-core#start-core/middleware
      server-functions            [sub-skill]   createServerFn (GET/POST), validator (Zod or function), useServerFn hook, server context utilities (getRequest, getRequestHeader, setResponseHeader, setResponseStatus), error handling (throw errors, redirect, notFound), streaming, FormData handling, file organization (.functions.ts, .server.ts).
        Load: pnpm exec intent load @tanstack/start-client-core#start-core/server-functions
      server-routes               [sub-skill]   Server-side API endpoints using the server property on createFileRoute, HTTP method handlers (GET, POST, PUT, DELETE), createHandlers for per-handler middleware, handler context (request, params, context), request body parsing, response helpers, file naming for API routes.
        Load: pnpm exec intent load @tanstack/start-client-core#start-core/server-routes

  @tanstack/virtual-file-routes
    virtual-file-routes           [core]        Programmatic route tree building as an alternative to filesystem conventions: rootRoute, index, route, layout, physical, defineVirtualSubtreeConfig. Use with TanStack Router plugin's virtualRouteConfig option.
      Load: pnpm exec intent load @tanstack/virtual-file-routes#virtual-file-routes

  @tanstack/router-plugin
    router-plugin                 [core]        TanStack Router bundler plugin for route generation and automatic code splitting. Supports Vite, Webpack, Rspack, and esbuild. Configures autoCodeSplitting, routesDirectory, target framework, and code split groupings.
      Load: pnpm exec intent load @tanstack/router-plugin#router-plugin

  @tanstack/start-server-core
    start-server-core             [core]        Server-side runtime for TanStack Start: createStartHandler, request/response utilities (getRequest, setResponseHeader, setCookie, getCookie, useSession), three-phase request handling, AsyncLocalStorage context.
      Load: pnpm exec intent load @tanstack/start-server-core#start-server-core

  @tanstack/devtools-event-client
    devtools-bidirectional        [core]        Two-way event patterns between devtools panel and application. App-to-devtools observation, devtools-to-app commands, time-travel debugging with snapshots and revert. structuredClone for snapshot safety, distinct event suffixes for observation vs commands, serializable payloads only.
      Load: pnpm exec intent load @tanstack/devtools-event-client#devtools-bidirectional
    devtools-event-client         [core]        Create typed EventClient for a library. Define event maps with typed payloads, pluginId auto-prepend namespacing, emit()/on()/onAll()/onAllPluginEvents() API. Connection lifecycle (5 retries, 300ms), event queuing, enabled/disabled state, SSR fallbacks, singleton pattern. Unique pluginId requirement to avoid event collisions.
      Load: pnpm exec intent load @tanstack/devtools-event-client#devtools-event-client
    devtools-instrumentation      [core]        Analyze library codebase for critical architecture and debugging points, add strategic event emissions. Identify middleware boundaries, state transitions, lifecycle hooks. Consolidate events (1 not 15), debounce high-frequency updates, DRY shared payload fields, guard emit() for production. Transparent server/client event bridging.
      Load: pnpm exec intent load @tanstack/devtools-event-client#devtools-instrumentation

  @tanstack/devtools
    devtools-app-setup            [core]        Install TanStack Devtools, pick framework adapter (React/Vue/Solid/Preact), register plugins via plugins prop, configure shell (position, hotkeys, theme, hideUntilHover, requireUrlFlag, eventBusConfig). TanStackDevtools component, defaultOpen, localStorage persistence.
      Load: pnpm exec intent load @tanstack/devtools#devtools-app-setup
    devtools-marketplace          [lifecycle]   Publish plugin to npm and submit to TanStack Devtools Marketplace. PluginMetadata registry format, plugin-registry.ts, pluginImport (importName, type), requires (packageName, minVersion), framework tagging, multi-framework submissions, featured plugins.
      Load: pnpm exec intent load @tanstack/devtools#devtools-marketplace
    devtools-plugin-panel         [core]        Build devtools panel components that display emitted event data. Listen via EventClient.on(), handle theme (light/dark), use @tanstack/devtools-ui components. Plugin registration (name, render, id, defaultOpen), lifecycle (mount, activate, destroy), max 3 active plugins. Two paths: Solid.js core with devtools-ui for multi-framework support, or framework-specific panels.
      Load: pnpm exec intent load @tanstack/devtools#devtools-plugin-panel
    devtools-production           [lifecycle]   Handle devtools in production vs development. removeDevtoolsOnBuild, devDependency vs regular dependency, conditional imports, NoOp plugin variants for tree-shaking, non-Vite production exclusion patterns.
      Load: pnpm exec intent load @tanstack/devtools#devtools-production

Warnings:
  ⚠ Found 2 installed variants of @tanstack/markdown across 2 versions (1.0.0 at /Users/ek/development/projects/areca-cms/apps/cms/node_modules/@tanstack/markdown, 0.0.15 at /Users/ek/development/projects/areca-cms/examples/demo-site/node_modules/@tanstack/markdown). Using 1.0.0 from /Users/ek/development/projects/areca-cms/apps/cms/node_modules/@tanstack/markdown.
  ⚠ Found 2 installed variants of @tanstack/react-start across 2 versions (1.168.60 at /Users/ek/development/projects/areca-cms/apps/cms/node_modules/@tanstack/react-start, 1.168.54 at /Users/ek/development/projects/areca-cms/examples/demo-site/node_modules/@tanstack/react-start). Using 1.168.60 from /Users/ek/development/projects/areca-cms/apps/cms/node_modules/@tanstack/react-start.
  ⚠ Found 2 installed variants of @tanstack/router-core across 2 versions (1.171.34 at /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+router-core@1.171.34/node_modules/@tanstack/router-core, 1.171.30 at /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+router-core@1.171.30/node_modules/@tanstack/router-core). Using 1.171.34 from /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+router-core@1.171.34/node_modules/@tanstack/router-core.
  ⚠ Found 2 installed variants of @tanstack/start-client-core across 2 versions (1.170.34 at /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+start-client-core@1.170.34/node_modules/@tanstack/start-client-core, 1.170.30 at /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+start-client-core@1.170.30/node_modules/@tanstack/start-client-core). Using 1.170.34 from /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+start-client-core@1.170.34/node_modules/@tanstack/start-client-core.
  ⚠ Found 2 installed variants of @tanstack/router-plugin across 2 versions (1.168.42 at /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+router-plugin@1.168.42_@tanstack+react-router@1.170.41_react-dom@19.3.0_react_57da8fa847d1a2aeab54d028dbae709d/node_modules/@tanstack/router-plugin, 1.168.38 at /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+router-plugin@1.168.38_@tanstack+react-router@1.170.36_react-dom@19.3.0_react_8aa1a55bc1c958632d47a9a3bc20664c/node_modules/@tanstack/router-plugin). Using 1.168.42 from /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+router-plugin@1.168.42_@tanstack+react-router@1.170.41_react-dom@19.3.0_react_57da8fa847d1a2aeab54d028dbae709d/node_modules/@tanstack/router-plugin.
  ⚠ Found 2 installed variants of @tanstack/start-server-core across 2 versions (1.169.39 at /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+start-server-core@1.169.39_crossws@0.4.12_srvx@1.0.5_/node_modules/@tanstack/start-server-core, 1.169.35 at /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+start-server-core@1.169.35_crossws@0.4.12_srvx@1.0.5_/node_modules/@tanstack/start-server-core). Using 1.169.39 from /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+start-server-core@1.169.39_crossws@0.4.12_srvx@1.0.5_/node_modules/@tanstack/start-server-core.
  ⚠ Found 2 installed variants of @tanstack/devtools-event-client across 2 versions (0.4.4 at /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+devtools-event-client@0.4.4/node_modules/@tanstack/devtools-event-client, 0.5.0 at /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+devtools-event-client@0.5.0/node_modules/@tanstack/devtools-event-client). Using 0.5.0 from /Users/ek/development/projects/areca-cms/node_modules/.pnpm/@tanstack+devtools-event-client@0.5.0/node_modules/@tanstack/devtools-event-client.
Notices:
  ℹ intent.skills is not set — all discovered skill sources are surfaced. A future version will require an explicit intent.skills allowlist; add one to opt in to specific sources.
Done in 338ms using pnpm v12.4.1
```
