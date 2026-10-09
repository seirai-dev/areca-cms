# Areca CMS editor guide

This guide is for client owners, editors, and agency staff who write and manage website content. Areca is the control room for authoring: editors change drafts here, and an owner or agency admin starts a site-wide release. The public website reads the content from that release.

## Find your workspace

After signing in, the workspace switcher at the top of the sidebar opens your recent sites and the sites you can access. A client member can work across that client's sites. Agency admins can also open the Agency workspace. Search (⌘K on Mac, Ctrl+K elsewhere) finds pages and common actions. On a phone, use the bottom tabs for Overview, Content, Library, and More.

The site **Overview** shows work that needs attention, shortcuts to create entries, recent edits, and (for owners and admins) recent activity. The site sidebar lists each content type, the shared Library, and links you are allowed to use.

![A current collection screen](screenshots/current-collection.png)

## Draft, ready, live

An entry moves through these states:

| State | What it means |
| --- | --- |
| Draft | Only the CMS has the latest changes. |
| Ready | An owner marked the current draft ready; it will be included the next time the site goes live. |
| Live | The current version is in the live site release. |
| Scheduled | The entry is queued for its chosen time. |
| Archived | Kept in the CMS and omitted from the site. |

Saving an entry does not make it public. **Mark as ready** copies the draft into the version eligible for a release. **Go live** publishes a snapshot of the whole site, including all ready changes. Owners and agency admins can perform these actions. Editors can create, edit, save, and preview drafts; publish controls explain why they are unavailable.

An entry can show **Edited since ready** when its editable draft has changed since the owner approved it. The ready copy is still the one eligible for the site; ask an owner to mark the newer draft ready before the next release.

## Create and edit an entry

1. Open a content type such as Articles and choose **New article**. You can also use a create tile on Overview or the sidebar’s **+** menu.
2. Fill in the fields shown for that content type. The large title field usually supplies the entry title. The slug is generated from the title until you edit it; it must be lowercase letters, numbers, and hyphens, and unique within its content type.
3. Rich text fields support headings, emphasis, links, lists, quotes, code, images, tables, and dividers. Use the insert menu or `/` while editing. Image fields open the Library picker.
4. Changes save automatically after a short pause. The top bar shows save status; use **Save** or ⌘S / Ctrl+S to save immediately. A new entry is created after it has enough information for a valid slug.
5. Open **Details** to edit the slug, structured fields, SEO information, status, or revision history. See the [SEO guide](SEO.md) for what the search, social, and structured-data fields do. **Preview** opens the draft on the site when preview is configured.

![Saved entry editor with the Details panel](screenshots/current-editor-seo.png)

Entry history appears after the first save. Owners and agency admins can restore a revision. If a save cannot reach the server, the editor keeps a local recovery copy in this browser and offers it when the entry is reopened. Review the recovered draft before reapplying it to the latest saved version.

## Make changes live

An owner can mark one or several entries ready from the editor or collection list. In a collection, choose **Select** to use the bulk action bar for **Mark as ready**, **Move to draft**, or **Delete**. The editor’s action menu also offers **Mark as ready & go live now**, **Schedule**, and, when relevant, actions to move an entry back to draft, archive it, or delete it.

Scheduling freezes the approved content and address at the time you schedule it. The editor shows **View approved scheduled version** while you can continue editing the draft separately; those later draft edits do not replace the scheduled version. The schedule uses the selected time zone and runs the release when due. Owners can cancel a scheduled version.

Use **Go live** in the site sidebar or Overview to review the site release. The panel shows changes included, release progress, errors, and prior releases. In **Production** mode, Go live builds and deploys the latest site snapshot, then verifies that the deployed site reports the publication ID. Production mode requires a configured deployment target and health-check URL; without them, publishing is blocked. The previous successful production release stays live if a new release fails. In **Demo** mode, Go live creates a clearly labeled demo publication without a production deploy or live verification; it does not make the website production-live.

Owners can request a rollback from a prior successful release in the Go-live panel. Areca queues a new, high-priority build using that release's saved snapshot and content hash. It does not build a new snapshot from today's drafts or erase newer drafts. A failed rollback can be retried.

![Go-live panel with changes and release history](screenshots/current-releases.png)

## Keyboard shortcuts

The account menu's **Keyboard shortcuts…** dialog lists the available shortcuts. The global shortcuts are ⌘K / Ctrl+K for search and commands, **g** then **o** for Overview, **g** then **l** for Library, **g** then **p** for People, and **g** then **s** for the workspace switcher. In a collection, **n** creates a new entry. **/** focuses page search (or opens the command palette when the page has no search). In the editor, ⌘S / Ctrl+S saves and ⌘. / Ctrl+. toggles Details. Single-key shortcuts pause while you type.

## Use the Library

The Library is shared across all sites in a client. It accepts JPEG, PNG, WebP, GIF, and PDF uploads, with a 20 MiB limit per file. Image fields select images; PDFs remain library files. Upload from the Library or from an image field; you can also drop files onto the Library page. Search by filename, open an item to edit its description (alt text), or open/copy its file link. Image files without descriptions can be filtered from the Library header.

Editors and owners can upload and update descriptions. Only owners and agency admins can delete files. A file that is still used by content or retained history cannot be deleted; remove all references first.

![Shared client Library](screenshots/current-library.png)

Uploaded files have public URLs, including files attached to drafts. Organization permissions control Library management, but anyone with a file URL can read it. See [media privacy](DEPLOYMENT.md#media-privacy) before uploading sensitive material.

## People and roles

Owners invite people from **People**. You can enter several email addresses separated by commas and choose **Editor** or **Owner** for the invitation. Pending invitations can be resent or revoked; membership roles can be changed later. An invitation expires after seven days. Editors do not see People, Settings, or Activity.

| Role | Main permissions |
| --- | --- |
| Editor | Create and edit drafts, preview, upload files, and update file descriptions. Cannot approve, schedule, archive, delete entries, restore revisions, publish, delete files, or manage people. |
| Owner | All editor tasks, plus approve and schedule content, archive/delete entries, restore revisions, run site releases and rollbacks, delete unused files, and manage client people and invitations. |
| Agency admin | All client and site capabilities, plus manage clients, sites, content types, agency access, branding, global activity, and AI configuration. Requires two-factor authentication. |

Agency admins can access all sites and manage agency-wide access from Agency › People. Members of a client can open all sites belonging to that client.

![People and organization-wide membership roles](screenshots/current-people.png)

## Activity and account preferences

Owners can open site Activity from the sidebar or the activity panel. It records content, people, and release actions. Agency admins can view the instance-wide activity log in Agency › Activity.

The account menu controls Light, Dark, or Auto appearance, interface language, keyboard shortcuts, Account, and sign-out. In Account you can enable two-factor authentication or regenerate recovery codes. Accounts without a required second factor can also disable it; agency admins must keep it enabled. Changing the interface language does not translate authored content.

## Using Areca on a phone

Use the top workspace control to choose a site and the bottom tabs to switch between Overview, Content, Library, and More. Content lists the site's content types; More contains the pages allowed by your role. The editor still saves drafts automatically; open Details for slug, fields, SEO, and history. The publishing indicator in the top bar opens the same Go-live panel.

![Article collection on a phone-sized screen](screenshots/current-mobile-collection.png)

## When you need help

If a release fails, open **Go live** and read the failed release details or build log. If an entry does not appear on the site, check that it is marked ready and that a successful Go live completed after that change. Ask an owner to check your role if a publishing action is disabled.
