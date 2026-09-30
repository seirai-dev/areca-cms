# Areca CMS — design brief (full UI/UX redo, 2026)

Status: **Implemented on `feat/full-ui-redo`.** This was the binding specification for the rebuild of `apps/cms`; the few places where the build differs are listed under [Deviations from this brief](#deviations-from-this-brief) at the end. The living design-system guide is [`docs/DESIGN.md`](../DESIGN.md). Backend behaviour (server functions, permissions, DB) did **not** change; this was a presentation and interaction rebuild.

---

## 0. Philosophy: clean, minimal, powerful, beautiful

Four tests every screen must pass before it ships:

1. **The newcomer test.** Someone who has never seen Areca can say what the screen is for and what to do next within five seconds, without reading help text.
2. **The grandparent test.** Someone who used it last month can find the same thing again. Places have one name, one icon, one location. Nothing important hides behind hover.
3. **The one-primary rule.** Each screen has at most one primary (ink-filled) button. Everything else is quieter.
4. **The whisper rule.** Secondary information (ids, hashes, route patterns, technical errors) is present but quiet. It sits in a smaller, lighter type, inside "Details" disclosures, or in a panel.

Language is human. We say **Go live**, not "Publish site". We say **Library**, not "Media assets", and **People**, not "Members & invitations". In the agency workspace we say **Clients**, not "Organizations". We say **Ready**, not "Published but not deployed". Sentences are in sentence case, with no exclamation marks and no jargon in primary UI. Technical words (build job, snapshot hash, application ID) appear only inside technical-details areas.

Inspirations: the Mantra sidebar and cards, the "Settings / Workspace" description-left/controls-right settings, and the "Proposal Activity" slide-over timeline. We borrow their calm; we do not copy their layouts.

---

## 1. The mental model we teach

### 1.1 Workspaces
Every signed-in person works *inside a workspace*.
- **A site** is a workspace: "Acme Website". Clients mostly only ever see one.
- **Agency** is a workspace, for agency admins only. It holds clients, all sites, people with agency access, the global activity log and branding.

The **workspace card** at the top of the sidebar always says where you are. Clicking it opens the **workspace switcher**. The switcher lists recent sites, all sites grouped by client, the Agency workspace for admins, and "New site…" for admins.

### 1.2 Content lifecycle: Draft → Ready → Live
One vocabulary everywhere (status pills, filters, the editor, the Go‑live panel):

| UI status | Backend truth | Pill |
|---|---|---|
| **Draft** | `status = draft` | grey pencil |
| **Ready** | `status = published` AND (`updatedAt` > live publication `createdAt`, or nothing is live yet) | accent dot, "Ready to go live" in long form |
| **Live** | `status = published` AND not pending | green dot (soft pulse once on mount) |
| **Scheduled** | `status = scheduled` | orange clock, with the time: "Fri 9:00" |
| **Archived** | `status = archived` | muted box |

Also, when a published entry has draft edits that differ from `publishedData`, show a small secondary marker: "Edited since ready" (a dot plus a tooltip).

- **Mark as ready** = `publishEntryFn`, the entry-level publish. Owners and admins only.
- **Go live** = `requestPublicationFn`, the site-level publish. Owners and admins only.
- **Move back to draft** = `unpublishEntryFn`.

The **Go‑live tray** at the bottom of the sidebar always shows the site's publishing state. It is the *only* place the site is published from, apart from the "Mark as ready & go live" shortcut in the editor and the Overview attention card.

### 1.3 Roles, as the UI shows them
- **Editor**: writes drafts. Publish-type controls are **visible but disabled**, with a tooltip or inline reason: "Only owners can publish. Your changes are saved as a draft and an owner can make them live." This follows the product decision *show disabled with reason*. People and Settings nav items are hidden for editors (they have no view permission there).
- **Owner**: everything in their client's sites, plus People.
- **Agency admin**: everything, plus the Agency workspace, plus site Settings (general, deployment, developer, content model).

---

## 2. Information architecture and routes

The old structure (top navbar, site tabs, `/admin/*`, `/orgs/*`, the Releases page, the Team and Activity tabs) is **removed**. New route map (file routes under `apps/cms/src/routes`):

| Route | Screen | Who |
|---|---|---|
| `/login`, `/setup`, `/invite/$token` | Auth: centred card | public |
| `/` | **Resolver**, no UI. Redirects to the last-used site (cookie `areca.lastSite`, validated against `me.sites`) → else the only site → else `/agency` for admins → else `/sites` picker (zero or several sites) | signed in |
| `/sites` | **Site picker**: card grid of accessible sites. Also the empty state "You don't have access to any sites yet". | signed in |
| `/sites/$siteId` | **Overview** of the site | member |
| `/sites/$siteId/c/$collectionKey` | **Collection**: cards or rows | member |
| `/sites/$siteId/c/$collectionKey/new` | **Editor** (new) | member |
| `/sites/$siteId/c/$collectionKey/$entryId` | **Editor** | member |
| `/sites/$siteId/library` | **Library** (media) | member |
| `/sites/$siteId/people` | **People** (members + invitations) | owner/admin |
| `/sites/$siteId/settings` | **Site settings**, horizontal tabs `?tab=general|deployment|developer|content` | admin |
| `/agency` | **Agency overview**: all-sites health plus first-run checklist | admin |
| `/agency/clients` | **Clients** list | admin |
| `/agency/clients/$orgId` | **Client** detail, tabs `?tab=sites|people|deployment|settings` | admin |
| `/agency/people` | **People with accounts** (users, agency access) | admin |
| `/agency/activity` | **Activity**: global audit | admin |
| `/agency/branding` | **Branding** | admin |

Overlays, addressable by search param so they can be deep-linked:
- `?panel=golive` on any `/sites/$siteId/**` route opens the **Go‑live panel**.
- `?panel=activity` on any `/sites/$siteId/**` route opens the **Activity panel** (owners and admins), filtered to this site through the server's `siteId` filter, with a toggle "All {client} sites".

Legacy redirects, so bookmarks keep working:
- `/sites/$id/media` → `/library`
- `/sites/$id/releases` → `/sites/$id?panel=golive`
- `/sites/$id/team` → `/people`
- `/sites/$id/activity` → `/sites/$id?panel=activity`
- `/admin*` → `/agency…`, with this mapping:
  - organizations → clients
  - users → people
  - audit → activity
  - branding → branding
- `/orgs/$orgId/members` → the site-less path `/agency/clients/$orgId?tab=people` for admins; owners go to the first site of that org at `/people`.

Do these with `beforeLoad` `redirect`s in thin route files.

### 2.1 Sidebar (desktop ≥ 1024px: fixed, 264px; 768–1023px: collapsible to a 64px icon rail)

```
┌──────────────────────────┐
│ ▣ Acme Website        ⌄  │  ← workspace card: site icon tile (initial on tinted square),
│   acme.com · ● Live      │    name, host + live dot. Click = switcher popover.
├──────────────────────────┤
│ 🔍 Search          ⌘K    │  ← opens command palette (looks like a field)
│ ⌂  Overview              │
│                          │
│ CONTENT               +  │  ← "+" = New… (menu of collections) ; admin: "Edit structure" in section menu
│ ▤  Articles          12  │  ← every enabled collection (admin: disabled ones greyed with "Off" tag)
│ ▤  Pages              4  │
│ ▤  Vacancies          2  │
│                          │
│ ◫  Library               │
│ ◎  People                │  (owner/admin)
│ ⚙  Settings              │  (admin)
│                          │
│         (flex)           │
│ ┌──────────────────────┐ │
│ │ 3 changes ready      │ │  ← Go‑live tray (see §4)
│ │ [      Go live     ] │ │
│ └──────────────────────┘ │
│ (AA) Kaan K.        ⋯    │  ← account row: avatar, name → account menu
└──────────────────────────┘
```

The **Agency workspace sidebar** uses the same shell, with different items: Overview, Clients, All sites (a list of sites with live dots, which navigates *into* each site workspace), People, Activity, Branding. There is no Go‑live tray. In its place is a small "System" status card that shows only when something needs attention (failed releases across sites).

The **account menu** is a popover from the account row:
- Name and email header.
- **Appearance**: segmented control Light · Dark · Auto.
- **Language**: English · Nederlands · Türkçe.
- **Keyboard shortcuts…**: a dialog listing the shortcuts.
- **Sign out**.

The theme and language switchers no longer live anywhere else in the shell, except that auth pages keep a small language and appearance control in their corner.

**Mobile (< 768px):**
- The sidebar becomes a **top bar** (workspace card compact + search icon + account avatar) plus a **bottom tab bar**: Overview · Content · Library · More.
  - Content opens a sheet listing the collections.
  - More opens a sheet with People, Settings, Activity and Go live.
- The Go‑live state appears as a small pill in the top bar ("3 ready"). Tapping it opens the Go‑live panel as a full-height sheet.

### 2.2 Page anatomy
- Canvas: `background-default` (warm off-white; near-black in dark mode).
- Content column: max 1120px, 32px side padding on desktop and 16px on mobile.
- **Page header**: large title (display style), one-line quiet subtitle, and a right-aligned action cluster with at most one primary button.
- Content is laid out in **cards** (`surface`, 16px radius, hairline border, near-zero shadow) or **inset grouped lists** (iOS Settings style: rows inside one rounded card, separated by hairlines inset from the leading icon).
- Settings pages use **description-left / controls-right sections**. The left column (280px) has a title and a one-sentence description; the right column has a card of controls. Below 900px it stacks.
- Save model for settings forms: a **floating save pill** at the bottom centre ("Unsaved changes · Discard · Save") appears with a spring when the form is dirty. Single toggles and alt text save instantly with a quiet "Saved" confirmation.

---

## 3. Screens

### 3.1 Auth (login, setup, invite)
- A centred 400px card on a soft canvas with a very subtle radial accent glow at the top. The brand logo tile and app name sit above the card. Small appearance and language controls sit in the top-right corner.
- **Login**: "Sign in to {app}".
  - Email and password.
  - Provider buttons: full-width, outlined, with the brand glyph. When both email and providers exist, "or" is written as a hairline divider.
  - Inline errors appear in the card (never as toasts).
  - No forgotten-password link, because that feature does not exist.
- **Setup**: "Welcome to {app}" / "Create the first admin account." Name, email, password (with a show/hide eye), then "Create admin account".
- **Invite**: "{Org} invited you" / "You'll join as an Editor — you can write and edit drafts." (role explained in plain language).
  - Signed out: create an account (the email is shown as a locked chip), or use a provider, or "Already have an account? Sign in".
  - **After account creation, accept automatically** (call `acceptInvitationFn` right after sign-up succeeds). There is no second click.
  - Signed in: a single "Join {Org}" button.
  - Invalid or expired: a friendly card with "Ask {inviter/your contact} for a new link" and "Go to sign in".
- The page is keyed off `form[data-ready="true"]` and `data-testid="auth-error"`; keep both.

### 3.2 Site picker `/sites`
- Title "Your sites".
- Card grid. Each card has a site tile, name, host, live state pill, "3 ready" if pending, and "Updated 2h ago".
- For admins: grouped by client with small section headers, and a "New site" card at the end.
- Search appears only when there are more than 6 sites.

### 3.3 Site Overview `/sites/$siteId`
A calm "what needs me" page. No vanity stats.
- **Header:** "Good morning, {firstName}", time-of-day aware. Subtitle: "{Site} · Live at acme.com ↗" or "Not live yet".
- **Attention strip.** Cards appear only when relevant, laid out horizontally and wrapping:
  - "3 changes ready to go live", with a list preview of the first 3 titles and a Go live button (disabled with a reason for editors).
  - "The last release failed", with a plain-language error and "See what happened", which opens the Go‑live panel scrolled to that release.
  - "2 scheduled", with next times.
  - Owners only: "Drafts waiting", which shows recent drafts by other people.
- **Create.** A row of large quiet tiles, one per enabled collection: "New Article", "New Page"… Each tile has the collection's icon. Its route pattern appears as a whisper.
- **Recently edited.** An inset list of up to 8 entries across collections, each with thumbnail, title, collection, status pill, relative time and avatar. Clicking a row opens the editor.
- **Activity** (owners/admins). The last 5 site events in timeline style, then "See all activity", which opens `?panel=activity`.
- **Empty site** (no collections). This is an illustrated empty card.
  - Title: "This site has no content types yet".
  - Admins see two paths:
    - "Connect your site project" → Settings › Developer
    - "Create a content type by hand" → Settings › Content
  - Others see: "Your agency is still setting this site up."

### 3.4 Collection `/sites/$siteId/c/$collectionKey`
- **Header:**
  - Title: the collection label.
  - Whisper line: "12 entries · /blog/$slug".
  - Right side:
    - a search field that expands from an icon, with the `/` shortcut;
    - a **view toggle** (Cards ▦ / List ☰), remembered per collection in localStorage;
    - "Select";
    - the primary **New {label singular}**, for example "New article". Derive the singular with a simple heuristic (strip a trailing "s"); fall back to "New entry".
  - Admin extra: a ⋯ menu with "Edit structure", which opens the schema editor sheet, and "Collection settings".
- **Filter**: a **sliding pill segmented control** with icons: All · Drafts · Ready/Live (server `published`) · Scheduled · Archived. The active pill glides between segments (motion `layoutId`).
- **Default view**: Cards when the collection has an `image` field, otherwise List.
- **Card**:
  - A 16:10 cover from the first image field. With no image, show a tinted placeholder with the title's first letter in large display type.
  - Title, two lines max.
  - The status pill with its animated icon.
  - A footer with "Edited 2h ago" and the author avatar.
  - Hover lifts the card by 2px, with a shadow and a ⋯ quick menu:
    - Open
    - Open in new tab
    - Mark as ready or Move back to draft
    - Delete…
  - Cards reveal with a stagger of 30ms per item, capped at 10 items.
  - **The card cover uses `view-transition-name: entry-{id}`** and the editor's cover or title uses the same name, so opening an entry morphs (TanStack Router `viewTransition: true` on the Link).
- **List row**: 56px, with thumbnail (32px, rounded), title, whisper slug, status pill, relative time and avatar. There is no table chrome and no column headers.
- **Select mode** (Photos-style), entered with "Select":
  - Checkboxes appear on cards and rows.
  - A floating action bar slides up with "{n} selected", Mark as ready, Move to draft, Delete, and Done.
  - Editors see those actions disabled, with the reason.
- **Paging**: "Show more" at the bottom (25 per page, server `offset`). Also a count.
- **Empty**:
  - With no entries: a friendly empty card, "No articles yet", with a primary "Write the first article".
  - With filters on: "Nothing matches" and "Clear filters".
- **Disabled collection** (admins only): a banner saying "This content type is turned off because it's no longer in the site project. Entries are kept but won't go live." New is hidden.

### 3.5 Editor (focus page)
The sidebar **tucks away**: the editor route renders without the app sidebar, as full-width focus mode with a slim top bar.

```
← Articles     Spring launch                     ● Saved   [👁] [⋯] [Mark as ready ▾]   [▥]
─────────────────────────────────────────────────────────────────────────────────────────────
                    Spring launch                                  │ Details              │
                    ───────────                                    │ URL                  │
                    [ rich text ... ]                              │ /blog/spring-launch ✎│
                                                                   │ Cover     [img]      │
                                                                   │ Category  News ⌄     │
                                                                   │ ──────────────────── │
                                                                   │ Status  ● Draft      │
                                                                   │ History (timeline)   │
```

**Top bar (56px):**
- Back link to the collection ("← Articles").
- The entry title in small type; it fades in once the big title scrolls away.
- The **save indicator**, one of:
  - "Saving…" (with spinner)
  - "Saved" (with a check that draws in)
  - "Saved 2m ago"
  - "Couldn't save" (red, with a retry link)
- A small quiet **Save** text button next to the indicator (manual save; ⌘S also works).
- **Preview** (eye icon): opens the signed preview URL in a new tab. Disabled until the entry exists and has a slug, with the reason in a tooltip.
- ⋯ menu:
  - Copy link to entry
  - Copy ID
  - Move back to draft (published only)
  - Archive
  - Delete…
- **The primary split button:** shown as "Mark as ready" for draft, archived or edited entries, and as "Live" or "Ready" (disabled) once there is nothing left to mark. Its menu:
  - Mark as ready & go live now (runs `publishEntryFn`, then `requestPublicationFn`)
  - Schedule…
  - Cancel schedule (when scheduled)
- **Editors** see the primary button disabled, with the reason tooltip.
- **Details panel toggle** (▥).

**Canvas:**
- Centred at 720px.
- The title is a borderless 40px display input with the placeholder "Untitled".
- Long-form fields follow, one after another:
  - rich text: minimal floating toolbar, see below;
  - textarea: borderless with a small label.
- Writing type is 17/28.

**Rich text:**
- A **compact sticky format bar** that appears under the top bar only while the editor is focused. It contains:
  - a block type dropdown: Paragraph / Heading 2 / 3 / 4 / Quote / Code;
  - B and I;
  - Link;
  - lists;
  - an "Insert" menu: Image, Table, Divider;
  - undo and redo.
- While the cursor is in a table, a contextual table bar appears.
- The bubble menu on selection stays: bold, italic, link, H2, H3.
- A **slash menu** is nice to have. Build it if time allows, using the same insert actions.
- Rich-text "Preview" (markdown render) moves into the ⋯ menu as "Preview formatting".
- Keep every current capability and shortcut.

**Details panel:**
- 340px on the right, collapsible, with its state remembered.
- On mobile it is a bottom sheet.
- Its content is grouped cards:
  1. **Page**:
     - The URL preview: the route pattern with the slug substituted, the slug inline-editable (mono, with a "Reset from title" link while the slug is manual).
     - Slug rules as a whisper.
  2. **Fields**:
     - Every non-canvas field, with labels on top.
     - Image fields show a thumbnail well: choose, replace or remove, plus an alt-text warning.
     - Reference fields use a searchable picker.
     - Boolean fields use a switch row.
     - Select fields: a segmented control when there are 4 options or fewer, otherwise a menu.
  3. **Status**: the status pill, plus "Scheduled for Fri 9:00 (Europe/Amsterdam) · Cancel". Also created, updated, published, author and ID (copy), in whisper type.
  4. **History**: the activity timeline in the style of the Proposal Activity reference.
     - Revisions are grouped: consecutive `update` revisions by the same author within 15 minutes collapse into one "Edited · 8 saves" item, which can be expanded.
     - Each item has an icon by note (created, edited, ready, back to draft, archived, scheduled, schedule cancelled, restored), the actor, and the time.
     - Restore is shown per item for owners and admins, disabled with a reason for editors. It keeps the existing confirm copy.

**Autosave (a UI-only change):**
- A draft saves automatically **2s after the last change**. It also saves on blur of the window (`visibilitychange`), before route navigation, and on ⌘S or the Save button.
- Only one save is in flight at a time. Edits made during a save are queued, and the baseline logic from today stays.
- **New entries:**
  - There is no server row until the title (or the slug) produces a valid slug.
  - The first autosave calls `createEntryFn` and then does a `replace` navigation to `/$entryId` without losing focus or scroll.
  - Until then, the indicator reads "Not saved yet — add a title".
- Validation errors from a partial save show inline, and the indicator says "Couldn't save — fix 1 field".
- **Leaving:**
  - The unsaved-changes dialog is gone.
  - If a flush is pending, navigation waits for it (max 3s).
  - If saving fails, a blocker asks "Leave without saving your latest changes?". This is the only case where it appears.
- Mark as ready flushes the save first.

**Scheduling popover** (replacing the dialog; it's a popover on desktop and a sheet on mobile):
- Title: "Schedule going live".
- Quick chips: "Tomorrow 9:00", "Monday 9:00", "In 1 hour".
- A date input and a time input.
- A timezone line: "Europe/Amsterdam · Change", which reveals the select.
- A "Schedule" button.
- Keep the `schedule-at` test id on the date-time value input (a hidden `datetime-local` driven by the date and time inputs is acceptable, or a visible `datetime-local`).

**Media picker** (from image fields and rich text):
- A large dialog with a Library grid, search, upload, and drop anywhere.
- Upload auto-selects the file. "Load more" as today.

### 3.6 Go‑live tray and panel
**Tray states** (bottom of the sidebar, a rounded card; animated between states with layout animation):

| State | Look |
|---|---|
| Up to date | A compact single row: "● Live · Up to date" in the quiet style, with the live dot pulsing softly once every 4s. Clicking opens the panel. |
| Changes ready | A card reading "3 changes ready" with the subtitle "Last live 2h ago", and a full-width ink **Go live** button. |
| Going live | A card reading "Going live…" with a step line (Queued, Building, Checking, Deploying) and an indeterminate progress bar. The card border gently pulses. |
| Failed | A card with a red icon, "Last release failed" and "See what happened". |
| Never live | "Not live yet" and **Go live**. |
| Editor | The same states; the Go live button is disabled and its tooltip gives the reason. |

**Panel** (a right slide-over, 480px, spring):
- **Header**: "Go live" and the site name, with a close button.
- **Status hero**: a big icon plus a sentence, for example "Acme Website is live. 3 changes are ready." When there are pending entries, the "What's changing" list shows them.
  - Titles come from a query of each enabled collection's entries with `status: published`, filtered to entries whose `updatedAt` is after the live `createdAt`.
  - Each title links to its editor.
  - Due scheduled items are listed too.
- **Controls** (owners/admins):
  - An "Urgent — skip the queue" switch (priority 100).
  - A **Go live** primary button.
  - Validation errors from `{ok:false, errors}` render as a friendly checklist: "Fix these first:", with each error parsed as `collection/slug: field: message` and linked to the entry when resolvable.
- **Releases timeline** (the old Releases page):
  - A vertical timeline. Each item shows a status icon (animated for pending or building), "Went live" / "Failed" / "Replaced" / "Waiting…", the relative time, and the requester.
  - An expandable "Details" section on each item holds:
    - the snapshot hash (mono whisper);
    - build steps (the jobs) with status, duration and attempts;
    - "View log", which opens a nested sheet with a monospaced log, copy button and auto-refresh;
    - "Cancel" for queued jobs.
  - Previously-live releases have "Restore this version" (rollback), with the existing confirm copy adapted to the new vocabulary.
  - "Show older" handles paging.
  - Unlinked jobs appear under "Other builds", collapsed.
- **Polling**: keep today's intervals (status every 5s while active, lists every 2s while busy, logs every 3s).

### 3.7 Activity panel
- A right slide-over, like the Go‑live panel.
- Timeline grouped by day ("Today", "Yesterday", then a date).
- Each item has:
  - an avatar (the actor, or a "System" glyph for actorless events);
  - a sentence, reusing `formatAuditAction`;
  - the target;
  - the time.
- The filter segmented control switches between "This site" (`siteId`) and "All {client} sites".
- Paging: "Show more".
- The same list component renders the full page at `/agency/activity`, where the filter is a client dropdown and it defaults to all.

### 3.8 Library `/sites/$siteId/library`
- **Header**: "Library", with the whisper "Shared by all {client} sites". Search. **Upload** is the primary action.
- **Grid**:
  - Responsive square tiles (160–200px); PDFs show a file glyph and "PDF".
  - Hovering a tile shows the filename.
  - A missing alt text shows a small amber dot with the tooltip "No description".
- **Drop anywhere**: a full-window overlay says "Drop to add to Library".
- **Upload progress**: toasts or tiles with a progress ring. Uploads stay sequential.
- **Clicking a tile opens the detail slide-over:**
  - a big preview;
  - **Description (alt text)**, saved on blur/Enter with a quiet "Saved";
  - info rows (dimensions, size, type, uploaded, by);
  - "Copy link" and "Open";
  - **Delete** (owners/admins; editors see it disabled with the reason). Keep the in-use error message.
- **Paging**: "Load more" (40).

### 3.9 People `/sites/$siteId/people` (owners/admins)
- **Header**: "People", with the whisper "Everyone here can open all {client} sites." Primary: **Invite people**.
- **Members**: an inset list of rows. Each row shows:
  - avatar, name and email;
  - a **role control**: a compact segmented control, Owner | Editor. Changing it asks for confirmation only when you are demoting yourself. Server errors about the last owner show inline;
  - a ⋯ menu with "Remove from {client}…".
  - Your own row carries a "You" tag.
- **Invitations** (only if any exist): rows with the email, role, "Expires in 5 days" or an "Expired" tag, and "Revoke". Accepted invitations are hidden.
- **Invite sheet:**
  - An email field. Several emails separated by commas are allowed; send them sequentially and report per email.
  - **Role cards**, radio style:
    - "Editor — Can write and edit drafts."
    - "Owner — Can also make changes live and manage people."
  - A "Send invitation" button, and a note that the link expires in 7 days.
- Admins also get a link: "Manage {client} in Agency ↗".

### 3.10 Site settings `/sites/$siteId/settings` (agency admins)
- Horizontal underline tabs, sliding indicator, `role="tab"`: **General · Deployment · Developer · Content**.
- **General**:
  - Name.
  - Production URL, with the helper "Where the live site is. Previews open on this address too."
  - Danger zone section: "Delete site…" with type-to-confirm.
- **Deployment**:
  - A provider card showing Dokploy.
  - An **Application picker**. If the client has verified Dokploy credentials, call `verifyDokployCredentialsFn` and show a searchable list of applications (name, appName, status). Otherwise, or as a fallback, provide a manual "Application ID" input and the link "Set up Dokploy for {client}".
  - Health check URL.
  - "Stop deploying" (clear target), with a confirm.
  - Helper text: "Without a deployment, going live just marks the release as live."
- **Developer**:
  - The site key (slug) with a copy button.
  - The **site token**: "Rotate token…", then a one-time reveal card with copy and an env snippet (`ARECA_CMS_URL=…`, `ARECA_SITE_TOKEN=…`).
  - **Manifest status**: the last-synced collections from `lastManifest` if available, with a quick-start snippet (`areca manifest push`).
- **Content**:
  - A list of collections (content types). Each shows its label, key, route, field count and an On/Off switch.
  - "New content type" opens the **schema editor sheet**. Row click opens that sheet too.
  - The schema editor keeps the existing drawer behaviour: segments for Fields and Settings, a locked slug row, drag reorder, type tiles, field form, discard guard, type-to-confirm delete. Only the look is redesigned.

### 3.11 Agency workspace
- **Overview `/agency`**:
  - While incomplete, a **Getting started** checklist computed from real data:
    1. Create a client.
    2. Add a site.
    3. Connect the site project (the site has collections).
    4. Invite the client.
    5. Go live (any site live).
    Each step has a direct action. The checklist collapses to "All set" once done.
  - Then these sections:
    - **Needs attention** across sites: ready changes, failed releases.
    - **Scheduled**.
    - **Sites**: card grid with live state, "3 ready" and updated time, opening into the workspace.
    - **Recent activity**: the last 8 items, with "See all" linking to `/agency/activity`.
  - The data comes from `getSitesOverviewFn` and `getHomeActivityFn`.
- **Clients `/agency/clients`**:
  - Cards or inset rows, each with client initials tile, name, "3 sites · 5 people", and created date.
  - Primary: **New client**, a sheet with name and slug. The slug is auto-suggested and shown as a whisper, and it cannot be changed later.
  - Search.
- **Client `/agency/clients/$orgId`**:
  - Header: client name with a slug whisper.
  - Tabs, each with `role="tab"`: **Sites · People · Deployment · Settings**.
  - **Sites**: a card grid plus **New site**. New site is a **two-step sheet**:
    1. Name, slug and URL.
    2. "Connect your site", with the token reveal and env snippet, a copy button, and "I've saved it".
    Keep the token alert test ids. Each site card has "Open" and "Settings" actions.
  - **People**: the same component as the site People page.
  - **Deployment**:
    - Dokploy URL and API key, with Save & verify, Verify and Remove.
    - The verified applications list.
  - **Settings**:
    - Rename (Save name).
    - Danger zone: delete the client. This is blocked while sites exist, with a link to the Sites tab. Type-to-confirm.
- **People `/agency/people`**:
  - Search, plus filter pills: Everyone · Agency admins · Owners · Editors. Owner and editor filtering combines with a client menu.
  - Rows show:
    - avatar, name, email, and "You";
    - membership chips ("Acme · Owner");
    - an **Agency access** switch. Your own row's switch is disabled with the reason, and switching asks for a confirm with the existing copy.
- **Activity `/agency/activity`**: the full-page activity list, with a client filter.
- **Branding `/agency/branding`**:
  - A two-column layout: the settings sections on the left, and a sticky **live preview** on the right. The preview is a mini mock of the new sidebar, a card and a button, in light and dark side by side.
  - Sections:
    - Identity: name, logo, favicon.
    - Colour: preset swatches as large round buttons with `aria-pressed`, plus an accent picker and hex input.
    - Typography: the font list rendered *in* each font.
    - Email: sender name.
  - The legacy colours notice and the reset stay.
  - The floating save pill saves.

### 3.12 Command palette (⌘K)
- Spotlight-style: centred, 640px, large input, grouped results.
- **Groups:**
  - Go to: the current site's pages, its collections and the other sites.
  - Create: "New {singular}" for each collection.
  - Actions: Go live (owners), Invite people (owners), Upload to Library, Open Activity, Switch appearance, Change language, Sign out.
  - Agency pages (admins).
  - **Search entries**: debounced `listEntriesFn({search})` across the current site's enabled collections (limit 5 each), showing title, collection and status.
- **Keyboard shortcuts** (listed in the account menu dialog):
  - ⌘K
  - `g o` Overview, `g l` Library, `g p` People, `g s` Switch site
  - `n` New entry, inside a collection
  - `/` Search, inside a collection or the Library
  - ⌘S Save
  - ⌘. Toggle the details panel

### 3.13 404 and errors
- 404: a centred card with a large quiet glyph, "This page doesn't exist" / "or you no longer have access to it.", and "Go to your workspace".
- Query errors: an inline card, "Couldn't load {thing}", with Try again. Keep `data-testid="query-error"`.

---

## 4. Visual system

### 4.1 Colour (oklch or hex in `styles.css`; light first, `html.dark` overrides)
**Neutrals** (warm, Apple-like):

| Token | Light | Dark |
|---|---|---|
| background-default (canvas) | `#F6F6F4` | `#0E0E10` |
| background-surface (cards, sidebar) | `#FFFFFF` | `#18181B` |
| background-elevated (popovers, panels) | `#FFFFFF` | `#1F1F23` |
| background-subtle (wells, hover fills) | `#EFEFEC` | `#232327` |
| sidebar | `#FBFBFA` | `#131315` |
| border-default | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.08)` |
| border-strong | `rgba(0,0,0,0.14)` | `rgba(255,255,255,0.16)` |
| text-primary | `#1D1D1F` | `#F5F5F7` |
| text-secondary | `#5E5E63` | `#AEAEB2` |
| text-muted | `#8A8A8E` | `#7C7C80` |

**Ink** (`--color-action-primary`, the primary button): `#1D1D1F` with white text; in dark mode `#F5F5F7` with `#111` text.

**Accent** (`--color-accent`, `--color-accent-soft`, `--color-accent-text`): **iris**, from Apple's systemIndigo: `#5856D6` light and `#7D7AFF` dark, with a 10–14% soft fill. The accent is used for:
- the active nav item (soft fill plus accent icon),
- selection,
- focus rings,
- links,
- switches,
- progress,
- the "Ready" status.

**Status**:
- success `#1F9D55` (pill bg at 12%)
- warning `#C77700` / `#FF9F0A` in dark
- error `#D93025` / `#FF6961` in dark
- info = accent

**Branding contract (important):**
- Instance branding now drives the **accent** tokens (`--color-accent`, `--color-accent-hover`, `--color-accent-soft`, `--color-accent-text`, `--color-text-accent`, `--color-icon-accent`, `--color-border-focus`), not the ink primary button.
- `--color-action-primary*` stays the ink button token.
- `branding.ts`, `branding.test.ts` and `e2e/branding.spec.ts` are updated **together**.
- Advanced colours (legacy) keep mapping onto their semantic tokens.
- The default preset "Areca" = iris + Inter. Other presets stay.

### 4.2 Type
Inter Variable everywhere (drop Bricolage from the default look; it stays selectable in Branding). Use the `ss01`/`cv11` features where they help, and tabular numbers for counts and times.

| Style | Size/line, weight, tracking | Use |
|---|---|---|
| display | 32/38, 650, -0.022em | page titles |
| title-1 | 24/30, 600, -0.018em | panel titles, editor top-bar titles |
| title-2 | 19/26, 600, -0.012em | card titles, section titles |
| headline | 15/22, 600 | row titles |
| body | 14/20, 400 | default UI |
| body-lg | 17/28, 400 | editor writing |
| callout | 13/18, 400/500 | secondary text, labels |
| caption | 12/16, 500 | whispers, meta |
| overline | 11/14, 600, +0.06em, uppercase | sidebar group labels |
| mono | IBM Plex Mono 12/16 | slugs, ids, hashes, logs |

The editor title input is 40/48, 700, -0.025em. Keep the `text-ds-*` utility mechanism (family + size + weight together), but rename to these styles, or map the old names onto them. Do not leave both scales in use.

### 4.3 Shape, depth, spacing
- Radius:
  - controls 10px
  - cards 16px
  - panels and sheets 20px (outer corners only)
  - pills 999px
  - thumbnails 10px
- Borders are hairlines (1px, `border-default`). Cards: border plus `0 1px 2px rgba(0,0,0,.04)`. Floating things (popovers, panels, tray while going live, save pill): `0 12px 40px -8px rgba(0,0,0,.18)` plus a hairline.
- The spacing scale is 4-based. Page gutters are 32px. Card padding is 20px. Inset rows are 52–60px tall with 16px padding.
- Control heights:
  - default 36px
  - large 44px (auth and mobile primary)
  - small 30px
  - Touch targets on mobile are ≥ 44px.

### 4.4 Iconography
- Phosphor, `regular` weight at 18px in navigation and 16px inline.
- The active nav item uses `fill` weight in the accent.
- Collections get a consistent icon (`Stack`/`Article`) per type, chosen by key heuristics: blog/article/post → Article; page → File; job/vacanc → Briefcase; event → Calendar; product → Tag; team/person → User; fallback → Stack.

### 4.5 Motion (subtle and purposeful, with expressive touches)
- Library: `motion/react`. Springs: `{ type: 'spring', stiffness: 420, damping: 36, mass: 0.9 }` for panels and sheets; `{ stiffness: 520, damping: 40 }` for small things. Nothing exceeds ~250ms perceived.
- **Page transitions:** a soft fade plus a 4px rise on route content, 180ms. Enable the router's view transitions for shared elements: card to editor, site card to overview.
- **Sliding indicators** (`layoutId`) for segmented controls, tabs and the active sidebar item.
- **Staggered reveals** for lists and grids: 30ms per item, max 10 items, opacity plus 6px y.
- **Animated status icons:**
  - The live dot pulses (a scale ring, once every 4s).
  - The "going live" ring spins.
  - The scheduled clock hand ticks once on mount.
  - The saved check draws in (SVG path length).
  - The failed icon shakes once, 2px.
- **Go‑live tray**: changes between states with layout animation; while a deploy runs, the border shimmers or pulses gently. On success, a short check-bloom (≤ 600ms, no confetti).
- **Floating bars** (selection bar, save pill) spring up from the bottom.
- `prefers-reduced-motion`: every animation above collapses to an instant change or a plain opacity fade. Use the `useReducedMotion` guard. The global CSS rule stays.

---

## 5. Implementation rules (for every engineer on this redo)

1. **Backend is frozen.** Do not change `src/server/**`, `src/db/**`, `src/adapters/**` or API routes. Exceptions need the design lead's approval. UI orchestration of existing functions is fine, for example "Mark as ready & go live", auto-accepting an invite after sign-up, or autosave calling `updateDraftFn`.
2. **Logic first, then markup.** Pull the logic out of tangled components into hooks under `src/features/<area>/` before rewriting the view, for example:
   - `useEntryEditor`, `useAutosave`
   - `useReleaseStatus`, `useGoLive`
   - `useCollectionEntries`
   - `useLibrary`, `useMembers`
   Keep `components/editor/utils.ts`, `query-keys.ts`, `admin/helpers.ts` and `collection-form.tsx` pure helpers. Move them if useful, but keep their behaviour.
3. **Folder layout:**
   - `src/components/ui/*`: rebuilt primitives.
   - `src/components/shell/*`: sidebar, workspace switcher, tray, account menu, palette, mobile bars.
   - `src/features/<area>/*`: screens, hooks and area components. The areas are `overview`, `collection`, `editor`, `golive`, `activity`, `library`, `people`, `site-settings`, `agency`, `auth`.
   - Route files stay thin: they gate, load and render a feature screen.
   - Delete the old components once they are replaced.
4. **i18n:**
   - Every user-visible string goes through `m.*` (Paraglide).
   - New keys use area prefixes (`shell_`, `overview_`, `collection_`, `editor_`, `golive_`, `activity_`, `library_`, `people_`, `settings_`, `agency_`, `auth_`).
   - Add them to `messages/en.json`. For **nl/tr, write the English text as a placeholder**; this is the product decision "English only for now".
   - Use `node apps/cms/scripts/i18n-add.mjs <json-file>`, which merges keys into all three locales atomically, so parallel work does not clobber the files.
   - Reuse existing keys when the English copy still fits.
   - Dead keys are pruned at the end.
5. **Test ids:**
   - Keep an existing `data-testid` whenever its concept still exists (see the inventory in the e2e specs). New interactive landmarks get kebab-case ids.
   - Keep the state attributes: `data-ready`, `data-dirty`, `data-status`, `data-locked`, `aria-pressed`.
   - Keep real ARIA roles: tabs are `role=tab`, menus are menuitems, and so on.
   - The e2e suite is rewritten for the new flows once the screens are done.
6. **Accessibility:**
   - Everything is keyboard reachable with visible focus rings (the accent, at 2px offset).
   - Contrast is AA in both themes.
   - Icon-only buttons have labels and tooltips.
   - Panels trap focus and return it on close.
   - Live regions are used for save status and deploy status.
7. **Both themes, all breakpoints.** Check every screen in light and dark, at 1440, 1024, 768 and 390px wide.
8. **No hard-coded colours** in components. Use tokens only, so that branding reaches everything.
9. **Performance:** no per-row queries for large lists without caching. Reuse query keys. Polling only happens while something is active.

---

## Deviations from this brief

Decided during implementation; the code and `docs/DESIGN.md` follow these.

| Brief | Built | Why |
|---|---|---|
| §3.4 filter "Ready/Live" | The status filter reads **Ready & live** | Both states share the server status `published`; the label says so plainly. |
| §3.3 "Drafts waiting" for owners only | Shown to **owners and agency admins** | Admins review drafts too; the card only lists drafts by other people. |
| §3.11 Client page shows its activity | Client activity lives at **`/agency/activity?client=<id>`** | One activity page with a client filter instead of a second copy; the client page links to it. |
| §3.12 palette "Go live" runs the release | Palette **Go live opens the Go-live panel** | Going live from a keystroke needs the "what's changing" context and the Urgent switch first. |
| §3.5 new-entry autosave does a `replace` navigation | Editor routes render through an **`EditorHost` in the collection layout** | New and existing entries share one mounted editor, so the first save swaps the URL without remounting (no lost focus, caret or scroll). |
| §3.5 "Keep every current … shortcut" | The rich-text **link popover has no ⌘K** | ⌘K belongs to the command palette everywhere; nothing advertises ⌘K for links. |
| §3.1 "brand logo tile and app name sit above the card" | The auth lockup is the **logo tile only** | The card's own heading already names the app ("Sign in to Areca"). |
| §3.1 "Signed in: a single Join button" | The invite button is named **"Join {Org}"** | Says what happens; the heading is "{Org} invited you". |
