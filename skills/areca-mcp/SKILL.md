---
name: areca-mcp
description: Connects an AI client to an Areca CMS site through its MCP server and uses its tools to write, edit, review and publish content. Covers the per-site connector URL, OAuth sign-in or personal keys, roles and go-live permission, the draft/ready/live workflow, field and Markdown formats, SEO, images, and every tool. Use when the user wants to connect Areca to an AI app or coding agent, or to create, update, approve, schedule or publish Areca CMS entries, upload images, or check what is live.
license: MIT
metadata:
  version: "0.1.0"
---

# Areca MCP

Every Areca site has its own remote MCP server. Through it an AI can read and write that site's content: entries, the media Library, releases and, for agency admins, content types. It edits CMS content and is separate from the `@areca-cms/site-sdk` website code (see the `areca-sdk` skill).

## Connect

- **Connector URL:** `https://<cms-host>/api/mcp/<site-slug>`. The user copies it from the site's **Connect AI** page in the CMS. Don't guess it: if `ARECA_CMS_URL` and the `siteKey` in `areca.config.ts` exist, it is `${ARECA_CMS_URL}/api/mcp/${siteKey}`. Confirm that with the user.
- **Transport:** Streamable HTTP (stateless, JSON responses). Suggested server name: `areca-<site-slug>`.
- **Auth:** OAuth 2.1 in the browser. Add only the URL, and the client opens a sign-in and consent page on first use. No secret goes in config.
- Claude Code: `claude mcp add --transport http areca-<slug> <url>`, then `/mcp` > Authenticate.
- Other clients: see [references/connect.md](references/connect.md). It covers Cursor, VS Code/Copilot, Codex, OpenCode, Gemini, Windsurf, ChatGPT, the Claude app and more, plus personal keys (`areca_mcp_…`) for clients without OAuth.

## First calls (always)

1. `get_site_info`: returns your role, what you **cannot** do, the collections and the site's publishing mode.
2. `get_collection_schema({ collection })`: returns exact field formats, an example payload and SEO guidance. Call it before every first write to a collection.

Tools your role can't use are not listed at all. If the user asks for one of those actions, explain who can do it and don't look for workarounds.

## Workflow and vocabulary

```
create_entry/update_entry -> draft
mark_ready (owner)        -> ready     approved for the next release, NOT live yet
go_live (go-live perm.)   -> live      builds and deploys every ready change
schedule_entry            -> scheduled goes live at a set time (also publishes other ready changes)
```

- `status`: `draft` | `ready` | `scheduled` | `archived`. To answer "what is live" use the flags: `live` (on the production site now), `pendingRelease` (approved changes waiting for the next go live) and `editedSinceReady`.
- Drafts are safe. Nothing changes the live site until an entry is marked ready **and** a go live happens.
- Only call `mark_ready`, `go_live`, `schedule_entry`, `rollback`, `delete_*` or `archive_entry` when the user explicitly asks.
- Writes return a `version`. Pass it as `expectedVersion` on the next `update_entry`. On a version conflict, call `get_entry`, reapply the change and retry.
- Show the user the `previewUrl` that create and update return (it's signed and valid for about 1 hour). If the site has no production URL, preview isn't available.

## Roles

| Role | Can |
| --- | --- |
| editor | read everything, create and edit drafts, upload images, edit alt text, preview |
| owner | everything an editor can, plus `mark_ready`, `unpublish_entry`, `archive_entry`, `cancel_schedule`, `delete_entry`, `restore_revision`, `delete_asset` |
| + go-live permission | `go_live`, `schedule_entry`, `rollback`, `cancel_build`. Granted per connection or key with "Allow going live" (owners and agency admins only). |
| agency admin | everything above, plus `upsert_collection` and `delete_collection` (needs 2FA) |

## Writing content

- **Rich text = Markdown**, never HTML (HTML tags show up as literal text). Use `##`, `###` and `####` headings, lists, links, tables and `>` quotes. Images go in as `![alt](asset:<assetId>)`.
- **Images:** call `upload_asset_from_url({ url, altText })` with a *direct* file link (JPEG, PNG, WebP, GIF or PDF, up to 20 MB), then use the returned `assetId` in image fields, `seo.ogImage` and Markdown. Always include alt text. If an upload fails, don't try other URLs. Ask the user for a working link, or continue without the image.
- **Field values:** `image` and `reference` take ids, `date` is `YYYY-MM-DD`, `datetime` is ISO 8601 with an offset, `select` must match an option exactly, and `slug` is lowercase with dashes and unique. Date fields are content only and never schedule an entry.
- **Clearing:** use `""` for a field or SEO text, `[]` for SEO lists and `false` for `noindex`/`nofollow`. Avoid `null` (`seo` rejects it). A key you leave out keeps its value.
- **SEO on every new entry:** `seo.title` (50-60 chars), `seo.description` (140-160), `focusKeyphrase`, `summary` (2-3 sentences) and 3-5 `keyTakeaways`. Add `faq` only when the body really answers those questions.
- **Schema:** if the site project has `areca.config.ts`, change the schema there and push it with the SDK rather than calling `upsert_collection`. `upsert_collection` replaces the whole field list.

Full formats, the SEO object, limits and errors are in [references/content.md](references/content.md). Every tool with its inputs is in [references/tools.md](references/tools.md).

## Errors

Tool errors come back as normal results with `isError: true` and a message that tells you the next step. Follow it. Common ones:

- `Validation failed`: call `get_collection_schema`.
- `changed since you last read it`: call `get_entry` and retry.
- `Only site owners…` or `Going live…`: tell the user who can do it.
- `Something went wrong on the Areca server (ref …)`: nothing is confirmed saved. Retry once, then report the ref.

Over HTTP, `401` means sign in again or reconnect. `403 mfa_required` means the agency admin must turn on 2FA. `429` means wait for `Retry-After` (120 requests/min per credential).
