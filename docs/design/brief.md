# Areca CMS design brief (TanStack design system pass)

Status: working specification for the September 2026 redesign. Every UI change in `apps/cms` follows this document. When it conflicts with older code, comments, or memory, this document wins.

Reference material:

- TanStack design system pages: https://tanstack.com/ds (colors, typography, iconography, shadows, effects, buttons, inputs, tabs, badges, dialog, drawer, dropdown, navbar, page-header, panel, stats, overlays, takeover, avatar, breadcrumbs, spinner).
- TanStack token source (real values): https://raw.githubusercontent.com/TanStack/tanstack.com/main/src/styles/app.css (a copy may exist at `/tmp/ts-app.css`). Key blocks are reproduced below.
- shadcn/ui conventions: components live in `src/components/ui`, are owned code, use `cn()`, CVA variants, `data-slot` attributes, Radix primitives from the unified `radix-ui` package.

## 1. Product read

Areca is a multi-site headless CMS for agencies: organizations own sites, sites have collections, collections have entries with a schema of fields, entries publish into releases that deploy. Users: agency admins (many orgs, many sites), org owners/editors (one org, a few sites). Audience for the open-source release: developers evaluating it in five minutes, and content editors using it daily.

Design read: product UI for technical and editorial users, TanStack visual language (bone/olive neutrals, green brand, Bricolage display), medium density, both themes first-class, calm and fast. Not a marketing site, not a dashboard of vanity metrics.

## 2. Tokens

Everything in `apps/cms/src/styles.css`. Tailwind v4, `@theme` blocks, class-based dark mode on `<html class="dark">` (next-themes, storage key `areca.theme`, default `system`).

### 2.1 Primitive ramps (TanStack, verbatim)

```css
--color-ds-green-100: #d8f0da;  --color-ds-green-200: #a2e1a9;  --color-ds-green-300: #69bc75;
--color-ds-green-400: #39af46;  --color-ds-green-500: #1d4226;
--color-ds-terracotta-100: #f9d8c4; --color-ds-terracotta-200: #edaa8d; --color-ds-terracotta-300: #e06e49;
--color-ds-terracotta-400: #d3481b; --color-ds-terracotta-500: #5f1a06;
--color-ds-blue-100: #d8f0f3; --color-ds-blue-200: #9cd5e2; --color-ds-blue-300: #61adbf;
--color-ds-blue-400: #3aa3c4; --color-ds-blue-500: #003e53;
--color-ds-amber-100: #fef6cc; --color-ds-amber-200: #fae884; --color-ds-amber-300: #f4d648;
--color-ds-amber-400: #ffa216; --color-ds-amber-500: #624a00;
--color-ds-purple-100: #cabfcc; --color-ds-purple-200: #ca8ec5; --color-ds-purple-300: #c56dcf;
--color-ds-purple-400: #b64cc7; --color-ds-purple-500: #541f5d;
--color-ds-neutral-0: #ffffff;   --color-ds-neutral-100: #eeebd4; --color-ds-neutral-150: #cec8b2;
--color-ds-neutral-200: #aea691; --color-ds-neutral-300: #756c5b; --color-ds-neutral-350: #5a5042;
--color-ds-neutral-400: #3e3529; --color-ds-neutral-500: #111111;
--color-ds-neutral-tint-100: #e8e7e5; --color-ds-neutral-tint-200: #c5c3bf;
```

### 2.2 Semantic tokens

Light (`:root`):

```
text-primary neutral-500 · text-secondary neutral-400 · text-muted neutral-350 · text-disabled neutral-200 · text-inverse #fff
text-accent green-500 · text-success green-500 · text-warning amber-500 · text-error terracotta-500 · text-info blue-400
background-default #fff · background-surface #fff · background-elevated #fff · background-subtle #fafafa · background-inverse neutral-500
scrim rgb(0 0 0 / .5)
border-default neutral-200 · border-strong neutral-400 · border-subtle neutral-100 · border-focus neutral-400 · border-error terracotta-400 · border-success green-400
icon-default neutral-500 · icon-accent green-500 · icon-muted neutral-300 · icon-success green-400 · icon-warning amber-400 · icon-error terracotta-400
action-primary green-400 · action-primary-hover green-300 · action-primary-text #fff
action-secondary neutral-100 · action-secondary-hover neutral-200 · action-destructive terracotta-400 · action-disabled neutral-200
status-success green-400 / bg green-100 · status-warning amber-400 / bg amber-100 · status-error terracotta-400 / bg terracotta-100 · status-info blue-400 / bg blue-100
surface-state-hover #1111110f · surface-state-pressed #1111111f · input-bg-hover #11111108
```

Dark (`html.dark`):

```
text-primary #fff · text-secondary #cec8b2 · text-muted #aea691 · text-disabled #3e3529 · text-inverse #111
text-accent #69bc75 · text-success #69bc75 · text-warning #f4d648 · text-error terracotta-200 · text-info #9cd5e2
background-default #111111 · background-surface #1f1f1f · background-elevated #2b2b2b · background-subtle #1b1b1b · background-inverse #fff
scrim rgb(0 0 0 / .65)
border-default #2d2d2d · border-strong #aea691 · border-subtle #232323 · border-focus #aea691 · border-error #e06e49 · border-success #69bc75
icon-default #aea691 · icon-accent #69bc75 · icon-muted #756c5b · icon-success #69bc75 · icon-warning #f4d648 · icon-error terracotta-200
action-primary #39af46 · action-primary-hover #69bc75 · action-primary-text #111111 (contrast on green)
action-secondary #2b2b2b · action-secondary-hover #3a3a3a · action-destructive #e06e49 · action-disabled #2b2b2b
status-success #69bc75 / bg #1d4226 · status-warning #f4d648 / bg #624a00 · status-error terracotta-200 / bg #2b1711 · status-info #61adbf / bg #003e53
surface-state-hover #ffffff1f · surface-state-pressed #ffffff29 · input-bg-hover #ffffff0a
```

Areca deviation from TanStack: brand and primary action are **green**, not blue. Blue is only `status-info`. Focus is a neutral border-colour lift (Inputs page), never a coloured ring, except keyboard `focus-visible` on buttons and links which uses a 2px `border-strong` outline offset 2px.

Whitelabel branding (`src/lib/branding.ts`) currently overrides `--primary` and friends. It must now override `--color-action-primary`, `--color-action-primary-hover`, `--color-text-accent`, `--color-icon-accent`, `--color-status-success` (light and dark variants), and derive `--color-action-primary-text` from contrast. Keep the existing branding API and tests green.

### 2.3 shadcn compatibility layer

Existing components use shadcn names (`bg-background`, `text-muted-foreground`, `border-border`, `bg-primary`, `bg-popover`, `bg-card`, `ring-ring`, `bg-destructive`, `bg-secondary`, `bg-accent`). Keep these working by aliasing them to the semantic tokens in `@theme inline`:

```
background → background-default · foreground → text-primary · card → background-surface · popover → background-elevated
primary → action-primary · primary-foreground → action-primary-text · secondary → action-secondary · secondary-foreground → text-primary
muted → background-subtle · muted-foreground → text-muted · accent → surface-state-hover (as colour: neutral-100 light / #2b2b2b dark) · accent-foreground → text-primary
destructive → action-destructive · border → border-default · input → border-default · ring → border-strong
success → status-success · warning → status-warning · link → text-accent
```

Remove the `ink`, `paper`, `clay`, `moss`, `fern` scales and any `--art-*` variables that only the old palette used (the auth art may keep two variables mapped to the green ramp).

### 2.4 Type

Fonts self-hosted via fontsource: `@fontsource-variable/bricolage-grotesque` (already present), `@fontsource-variable/inter`, `@fontsource/ibm-plex-mono` (weights 400, 500). `font-display: swap`.

```
--font-sans: 'Inter Variable', ui-sans-serif, system-ui, sans-serif
--font-display: 'Bricolage Grotesque Variable', var(--font-sans)
--font-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace
```

Scale (TanStack `text-ds-*`, register as Tailwind text utilities):

| role | size/line | weight | font |
|---|---|---|---|
| heading-1 | 36/41 | 500 | display |
| heading-2 | 28/34 | 500 | display |
| heading-3 | 24/29 | 700 | display |
| heading-4 | 20/25 | 700 | display |
| heading-5 | 16/21 | 700 | display |
| heading-6 | 14/18 | 500 | display |
| body-lg | 18/28 | 400 | sans |
| body-md | 16/24 | 400 | sans |
| body-sm | 14/20 | 400 | sans |
| body-xs | 12/17 | 400 | sans |
| label-md | 14/17 | 500 | sans |
| label-sm | 12/14, tracking .5px | 500 | sans |
| mono-sm | 14/21 | 400 | mono |
| mono-xs | 12/16 | 400 | mono |
| mono-caps | 12/14, tracking 1.5px, uppercase | 500 | mono |

Usage: page titles heading-2, section titles heading-4, table and form text body-sm, labels label-md, help text body-xs in text-muted, slugs/keys/hashes/routes mono-xs. `h1`..`h6` elements get the display font by default in `@layer base`. Body is 14px Inter. Eyebrows (mono-caps) are rare: at most one per screen.

### 2.5 Shape, elevation, motion

- Radius: `--radius-control: 8px` (buttons, inputs, selects, menu items), `--radius-surface: 12px` (dialogs, drawers, popovers, inspector, tiles), badges are pills, avatars are circles. No other radii.
- Shadows (TanStack): xs `0 1px 2px 0 rgb(0 0 0 / .03)`, sm `0 1px 3px 0 rgb(0 0 0 / .05), 0 1px 2px 0 rgb(0 0 0 / .03)`, md `0 4px 6px -1px rgb(0 0 0 / .05), 0 2px 4px -1px rgb(0 0 0 / .03)`, lg `0 10px 15px -3px rgb(0 0 0 / .05), 0 4px 6px -2px rgb(0 0 0 / .03)`, xl `0 20px 25px -5px rgb(0 0 0 / .05), 0 10px 10px -5px rgb(0 0 0 / .02)`, 2xl `0 25px 50px -12px rgb(0 0 0 / .2)`. Dropdowns use lg, dialogs 2xl, drawers 2xl. Page content never has a shadow.
- Motion: `--motion-duration-fast: 180ms`, `--motion-duration-sheet: 280ms`, `--motion-ease-standard: cubic-bezier(.2,.8,.2,1)`, `--motion-ease-sheet: cubic-bezier(.32,.72,0,1)`. Keyframes: `dialog-panel-in/out` (opacity + scale .96), `dialog-scrim-in/out`, `drawer-right-in/out` (translateX), `ds-enter-rise` (opacity + 8px rise, used on route content), `ds-pop-in` (dropdowns, popovers). Hover transitions 120ms on colour/background/border only. `motion/react` is used for layout animation (collections rail reorder, inspector segment change, publish status transitions, field list reorder). All of it collapses under `prefers-reduced-motion: reduce` (keep the existing global override and use `useReducedMotion()` in Motion components).
- Z scale: `--z-navbar: 100`, `--z-scrim: 999`, `--z-overlay: 1000`, `--z-above-overlay: 1200` (toasts, command palette). No other z-index values.

### 2.6 Icons

`@phosphor-icons/react` only. Default weight `regular`, size 16 in text and controls, 20 in the navbar and identity strips, 24 in empty states. `duotone` weight for entity tiles (`EntityIcon`) and empty-state marks. Never hand-roll SVG. Remove `lucide-react` from the dependency list when the last import is gone.

## 3. Shell

### 3.1 Navbar (replaces the sidebar and the breadcrumb header)

58px, sticky top, `background-default/90` with `backdrop-blur`, hairline `border-subtle` that fades in on scroll. Three regions:

- Left: brand mark + name (branding-aware), then the **site switcher**: a button showing the current site (icon tile + name + live dot) or "Choose a site". Opens a `Command` popover: search input, sites grouped by organization, recent sites first, "All sites" and "New site" (admins) at the bottom. Keyboard: `g s` opens it.
- Centre: on a site page, nothing (the site tabs live in the identity strip below). Outside a site: nothing. Keep it empty rather than duplicate links.
- Right: `Agency` link (agency admins only, active when under `/admin`), Cmd+K trigger (icon button with `⌘K` hint), theme toggle, language switcher, user menu (avatar; menu holds name/email, Theme, Language, Sign out).

Mobile (< 900px): switcher becomes an icon button that opens the same command list in a bottom drawer; user menu holds Agency and theme/language.

Test ids to keep: `open-search`, `sign-out`, `dashboard-nav` (brand link), `sites-nav` (site switcher button), `agency-nav` (Agency link), `branding-nav` (inside Agency sub-nav), `team-nav` (site Team tab), `site-nav` (site tab row).

### 3.2 Site identity strip

One row, 44px, directly under the navbar on every site route: `EntityIcon` (globe, duotone), site name in label-md, live dot (green, only when live) with tooltip "Live since …", slug in mono-xs text-muted, an icon button opening the production URL (`ArrowSquareOut`). Right side: the site section tabs (Content, Media, Releases, Team, Settings) as underline tabs (`nav-tab` pattern, 40px, label-md). Content begins at roughly 120px from the top of the viewport. Organization name is not shown here; it lives in the switcher.

Inside the entry editor the strip is replaced by the editor toolbar (see 4.3).

### 3.3 Page frame

`max-w-6xl mx-auto px-6 py-6`. No page-level cards. Sections are separated by 32px of space or a `border-subtle` hairline. Page titles use `PageHeader` (heading-2, optional body-sm description in text-secondary, actions right). On site routes, the identity strip already names the site, so the page header names only the section ("Media", "Releases", "Settings"). On Content there is no page header at all; the collections rail is the header.

### 3.4 Command palette

Keep `command-palette.tsx`. Style: rounded-xl elevated surface, shadow-2xl, scrim, `ds-pop-in`. Groups: Sites, Sections of the current site, Collections of the current site, Agency, Actions (New entry in current collection, Publish site, Toggle theme).

## 4. Screens

### 4.1 Home (`/`)

Activity-first. Merges the `/sites` list (keep the `/sites` route as a redirect to `/` for links and tests; `sites-page` test id moves to the home list).

Layout: two columns on `lg` (8/4), stacked below.

- Left: heading-2 "Sites" with search input and org filter (filter only when more than one org), then the sites table (`SitesTable`): icon tile, name + slug (mono-xs), organization (admins only), status pill (`live` with dot, or `Not live` muted), pending changes count (number of published-but-not-released entries, from `getSitesOverviewFn`), last updated (relative, "2h ago", tooltip absolute), row kebab (Open, Publish, Settings). Rows are 44px, click navigates to Content.
- Right: three flat blocks separated by hairlines: **Needs publishing** (sites with pending changes, each a row with "Publish" ghost button), **Scheduled** (upcoming scheduled entries across sites: title, site, time), **Recent activity** (last 8 audit rows, reuse `audit-log-list` compact variant). Each block has an "empty" line when nothing is pending ("Nothing waiting to go live.").
- First-run: when the user has zero sites, replace both columns with the onboarding checklist (`get-started`): four steps (Create an organization, Create a site, Add a collection, Connect the SDK with `areca init --site-key …`), each with done state, description and action. Keep `get-started` test id.

Remove: greeting, vanity stat tiles, "Welcome back".

### 4.2 Content (`/sites/$siteId`)

Two panes below the identity strip.

- **Collections rail** (left, 260px, sticky, scrolls independently): heading-6 "Collections" with count and an "Add" icon button (admins, keep `add-collection`), a filter input appearing when more than 8 collections, then the list: each row is an `EntityIcon` (Stack, duotone), label (label-md), route (mono-xs muted), entry count right-aligned, disabled collections shown with `text-disabled` and a "Disabled" mono-caps tag. Selected row has `surface-state-hover` background and a 2px left green bar. Rows animate with Motion `layout`. Test ids: `collection-<key>` (keep `collection-articles`), `collection-menu` on the row kebab (Configure fields, Settings, Delete).
- **Entries pane** (right): top row with the collection name (heading-4), route (mono-xs), status filter (segmented: All, Draft, Published, Scheduled, Archived), search, and "New entry" primary button (`new-entry`). Then the entries table: checkbox, thumb (`EntryThumb`), title + slug, status pill, updated (relative), author (avatar xs + name), kebab (Preview, Publish, Unpublish, Delete). Bulk bar (`bulk-actions`) slides up from the bottom of the pane when rows are selected: count, Publish, Unpublish, Delete. Pagination via `ListPagination`.
- **Release status bar**: a single-line surface above the entries pane, full width of the right pane: icon, "Live site is up to date" or "N changes waiting", live-since hash in mono-xs, `Urgent` checkbox, `Publish site` button (`publish-site`). Keep `release-live`, `release-status`.
- No collection selected (site has none): the right pane is the empty state (duotone Stack icon, "No collections yet", one sentence, "Add collection" primary). When the site has collections but none is selected, auto-select the first.
- URL: `/sites/$siteId` shows the first collection; `/sites/$siteId/c/$collectionKey` selects one. The `?tab=` query goes away.

**Collection drawer** (right `Sheet`, size lg, anchored under the navbar) holds two segments: **Fields** and **Settings**.

- Fields: compact reorderable list (drag handle, type icon from a fixed map, label label-md, key mono-xs, chips: Required, Unique, Localized as mono-caps). The Slug row is locked (lock icon, no drag). Clicking a row opens the field form in a nested panel of the same drawer (slide left): label, key (auto from label until edited), type (tile picker `field-type-tile-<type>`, 2 columns, icon + name + one-line description), required, help text, type-specific options (select options, reference collection, number range). Save returns to the list. "Add field" (`add-field`) opens the same panel with the picker first. Keep test ids `field-row-N`, `field-key-N`, `field-label-N`, `field-type-N` on the list rows and form inputs so the e2e can address them; the row index follows the visible order.
- Settings: label (`collection-label`), key (`collection-key`, mono, locked after create), route pattern (`collection-route`), enabled switch, then a Danger zone hairline with "Delete collection" (`delete-collection`, type-to-confirm dialog).
- Sticky footer: "All changes saved" / "Unsaved changes" and `Save collection` (`save-collection`).
- Create collection (`add-collection`) opens the same drawer in create mode with Settings first, then Fields.

### 4.3 Entry editor (`/sites/$siteId/c/$collectionKey/$entryId` and `/new`)

The identity strip is replaced by the **editor toolbar** (56px, sticky): back arrow to the collection (`Back to Articles`), site + collection in mono-xs muted, entry title (label-md, truncates), save state text ("Saved 2m ago" / "Unsaved changes" with an amber dot, `entry-dirty`), then actions: `Save draft` (secondary, `save-draft`), `Preview` (ghost, `preview-entry`), `Publish` split button (primary: Publish now `publish-now`; menu `publish-menu`: Schedule `schedule-entry`, Cancel schedule), overflow kebab (Unpublish, Archive, Delete). Status pill (`entry-status`) sits next to the title.

Body: two columns, `minmax(0,1fr) 320px`, the inspector sticky.

- **Canvas** (max-width 760px, centred in its column): the title field is a borderless heading-1 input with placeholder "Untitled". Fields of type richtext render as the document body: borderless, sticky formatting toolbar under the editor toolbar (paragraph/heading, bold, italic, link, lists, quote, code, image, table, rule, undo/redo) with an `Edit | Preview` segmented toggle at its right end. Textarea fields render as borderless multi-line areas with a label-sm heading. Long text is set in body-md. Everything on the canvas is separated by whitespace, not boxes.
- **Inspector** (surface, rounded-xl, border-default): segmented control **Fields | Details | Revisions**. Fields: all non-canvas fields (slug with mono input, dates, selects, booleans, numbers, references, images with `Choose` opening `media-picker`, `image-field-thumb`) in a vertical form with label-md labels and body-xs help. Details: status, created, updated, published, scheduled-for, author, entry id (mono, copy). Revisions: list of revisions (time, author, "Restore" ghost), current one marked.
- Unsaved-changes guard stays. Schedule dialog keeps `schedule-at` and `schedule-confirm`.

### 4.4 Media (`/sites/$siteId/media`)

Page header "Media" with description "Shared by every site in this organization", `Upload` primary (`media-upload`), and a full-width drop zone that appears while dragging files over the page. Below: a table (thumb 40px, filename in label-md with mono-xs extension, dimensions, size, uploaded relative, uploader) with search by filename. Clicking a row opens the **preview panel**: on `lg` a right column (360px) inside the page, below `lg` a drawer. Panel: large preview on `background-subtle`, filename, alt text input (saves on blur), dimensions/size/type, URL with copy, "Open" link, "Delete" destructive ghost with confirm. Keep `media-card-<filename>` as the row test id and `asset-drawer` on the panel.

### 4.5 Releases (`/sites/$siteId/releases`)

Page header "Releases", description "Every publication of this site. Roll back to any that was live." Single vertical timeline (`publications`): a 1px rail on the left with a dot per publication (green filled for live, muted for superseded, amber for building, terracotta for failed). Row: status pill (`publication-live` etc.), requested at, requested by, hash mono-xs, and a chevron. Expanding a row (Motion height animation) shows the build job(s) (`build-jobs` region inside the row): status, attempts, duration, `Logs` button opening a drawer with the log text in mono-xs, `Cancel` for queued jobs. Row overflow: `Roll back to this` (`rollback-publication`, confirm dialog). Empty state: "Nothing published yet" with a Publish site button when the user can publish.

### 4.6 Settings pages (site settings, branding, organization detail, users, audit)

`SectionedPage` pattern: left anchor rail (sticky, label-md links, active one green) and flat sections on the right: heading-4 title, body-sm description, fields, a `border-subtle` hairline between sections. A sticky bottom **save bar** (surface, shadow-lg) appears only when the page is dirty: "Unsaved changes" and `Save changes` (keep per-page test ids `save-deployment-target`, `save-branding`, `reset-branding`). The Danger zone section has a terracotta heading and a hairline in `border-error`, no red box.

- Site settings: General (name, slug with copy `settings-site-slug`, production URL `site-production-url`), Deployment target (`application-id`, `health-check-url`), Site token (`site-token-alert`, `site-token-value`, rotate), Danger zone (delete site).
- Branding: Identity, Appearance (accent, font, advanced per-mode colours), Email. Live preview becomes a sticky right column that renders the real components (button variants, a nav-tab, a badge, an input) under both modes stacked.
- Agency area (`/admin/*`): a layout with a left sub-nav (Organizations, Users, Audit log, Branding) in the same anchor-rail style, page content right. Organization detail: identity strip (Buildings icon, name, slug) plus one underline tab row: Overview (General form), Members (`invite-member`, `invite-email`, `pending-invitations`), Sites (`new-site`, `site-name`, `site-slug`), Activity (audit list). Org owner routes (`/orgs/$orgId/members`, `/audit`) reuse the same frame with Members and Activity.
- Users: table with avatar, name, email, org chips, agency-admin switch in the row menu.
- Audit: day-grouped timeline, compact rows (avatar xs, actor, action, target link, relative time).

### 4.7 Auth (login, setup, invite)

Split layout stays. Left column: brand mark, heading-2, body-sm description, form (label-md labels, 40px inputs, primary button full width), provider buttons below a hairline. Right column: `auth-art` on `#111` (dark) or `neutral-100` (light) with contour lines in the green ramp at low alpha, tagline in display heading-2 and body-sm. Branding accent still tints the lines.

### 4.8 Empty, loading, error states

- Every list has a designed `EmptyState`: duotone Phosphor icon 24px in `icon-accent`, heading-5, one sentence body-sm text-secondary, one primary action. Flat, centred in the pane, no box.
- Loading: skeletons that match the final layout (table rows, rail rows, inspector fields). No spinners except inside buttons (`Spinner` 16px, currentColor).
- Errors: `QueryError` inline with retry. Toasts (sonner) only for transient confirmations.

## 5. Components (`src/components/ui` and shared)

Restyle in place, keep exported names and props so call sites keep compiling:

- `button`: variants primary, secondary, ghost, link, destructive, outline (alias of secondary with border); sizes xs 28px, sm 32px, md 36px, lg 40px, icon sizes to match; radius control; `active:translate-y-px`; keyboard focus outline as in 2.2. Split button and button group helpers added.
- `input`, `textarea`, `select`: 36px (sm 32px), `border-default`, hover `input-bg-hover`, focus `border-strong` only, error `border-error`, label above via `FormField`.
- `badge`: pill; tones default (neutral), success, warning, error, info, muted; optional leading dot only for live/running states.
- `tabs`: `line` variant is the default (underline, 40px, label-md, green 2px indicator animated with Motion `layoutId`); `segmented` variant (track on `background-subtle`, pill thumb) for in-page switches.
- `dialog`: sizes xs..xl, `background-elevated`, `border-default`, rounded-xl, shadow-2xl, scrim, `dialog-panel-in/out`, 1rem viewport gutter.
- `sheet` (drawer): right/left/bottom, sizes, anchored to navbar by default, `drawer-*-in/out`, header with title and controls, scrollable body, footer.
- `dropdown-menu`, `popover`, `command`: `background-elevated`, rounded-xl, shadow-lg, `ds-pop-in`, item hover `surface-state-hover`, pressed `menu-item-pressed`.
- `table`: heavy head rule (`border-strong` 1px under the header), rows 44px, `border-subtle` between rows, hover `surface-state-hover`, selected `status-success-bg/40`.
- `card`: rename usage; it becomes `Surface` (bordered rounded-xl) used only for overlays, inspector and release bar. Page sections use `Section` (title, description, children, hairline).
- Shared: `EntityIcon` (duotone Phosphor, tones), `StatusBadge`, `EmptyState`, `DataTable`, `ListPagination`, `ConfirmDialog`, `FormField`, `QueryError`, `SectionedPage`, `SaveBar` (new), `IdentityStrip` (new), `SiteSwitcher` (new), `Navbar` (new), `Timeline` (new, releases and audit), `Spinner` (new).

## 6. Conventions and guardrails

- One accent (green), one radius system, one icon family, one font stack. No gradients, no glows, no decorative dots, no eyebrows above every heading, no em dashes anywhere in UI strings.
- Strings go through paraglide: add keys to `messages/en.json`, `nl.json`, `tr.json` (short, plain translations). Re-read a messages file right before editing it; edit with targeted replacements, never rewrite the file. Key prefix by area (`shell_`, `home_`, `content_`, `editor_`, `media_`, `releases_`, `settings_`, `admin_`, `auth_`).
- External contracts are untouchable: everything under `src/server/**`, `src/routes/api/**`, the SDK, DB schema. UI-only server functions (like `getSitesOverviewFn`) may gain fields.
- Data test ids listed in this brief and used by `apps/cms/e2e/**` must keep working. When a flow changes structurally (tabs to rail, tab to drawer), update the spec in the same task.
- Definition of done per task: `pnpm --filter cms typecheck` and `pnpm --filter cms lint` pass; the affected e2e specs pass with `playwright test --project=chromium --no-deps` against the LAN origin in `.env.local`; both themes checked.
- Mobile: every two-pane layout collapses to a single column below `lg`; rails become a top segmented selector or a drawer.
