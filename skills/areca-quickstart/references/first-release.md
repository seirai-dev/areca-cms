# First release

The first release gives the project something to pull. `areca pull` fails with "No publication exists" until a release is live, and `areca.gen.ts` is only written by a successful pull. So the release comes before the first build check.

Plan:

1. Check the publishing mode.
2. Create sample entries.
3. Fill the sections.
4. Mark everything ready.
5. Ask, then go live.
6. Wait for the build to finish.
7. Pull.
8. Verify.
9. Decide what to do with the samples.

Steps 2 to 6 use MCP tools. Without MCP, see [Code-first](#code-first-without-mcp).

## 1. Check the publishing mode

Call `get_site_info`. Read `site.publishingMode` and `site.deploymentConfigured`. To learn whether the site was ever live, call `list_publications`: any publication with status `live`, or with `publishingMode: "production"` and a `deployedAt` date, means it has gone live.

Older CMS versions do not report `deploymentConfigured` and do not list `set_publishing_mode`. Then treat the deployment as not configured, and ask the user to change the mode in the UI (below).

- **Demo:** continue.
- **Production, never live:** explain the choice. Demo means the release is pulled by `areca pull` and never shown to visitors. Production means the site builds and deploys. For the first release, use demo.
  - Agency admin, and `set_publishing_mode` is in your tool list: ask the user for a yes, then call it with `mode: "demo"`.
  - Anyone else: ask the user to change it in **Settings › Deployment › Mode** (Demo, no production deployment), then wait.
- **Production, already live:** stop. Do not go live. A live production site must not get sample content. Ask the user whether to use a separate demo site. Read [connect.md](connect.md) for demo mode.

## 2. Create sample entries

Get the schema for each collection before you write (`get_collection_schema`). Create in dependency order: referenced entries first. For example, authors before posts, departments before vacancies.

For each collection:

- The title starts with `[Sample]`, for example `[Sample] Our first post`. If the collection has no title field, put the prefix on its main text field instead (for example the `name` of categories).
- Pass the slug inside `fields`, as the `example` in `get_collection_schema` does: `fields: { slug: "sample-our-first-post", ... }`. It is lowercase with dashes.
- Fill every required field with realistic content. Keep it short, but complete.
- Use the company name and details from the interview where they fit.
- Fill the full SEO object. Follow the rules in the `areca-mcp` skill (title 50 to 60 characters, description 140 to 160, focus keyphrase, a 2 to 3 sentence summary, 3 to 5 key takeaways, FAQ only when the body answers questions).
- Images: do not guess image links. Use an image only when the user gives you a direct link, through `upload_asset_from_url` with alt text. Otherwise leave image fields empty.
- Rich text is Markdown, not HTML.

On a multilingual site:

- Write the main language with `create_entry` (no `locale`).
- Write each other language with one `update_entry` per language, with `locale` set. Fill the required fields in every required language.
- Check `translations` with `get_entry` before you mark it ready.

Then check the result with `list_entries` (status `draft`) and `get_entry` for one sample.

## 3. Fill the sections

For each section in the plan:

1. `get_global` with the section key. Note the `id` and the `fields`.
2. `update_global` with every required field. Use the company details from the interview for `companyInfo`. For other copy, write short placeholder text, and say so to the user.
3. For `seo: true` sections, fill `seo` with the same rules as entries.
4. If the section needs a page preview, check that `previewPath` is set.

## 4. Mark everything ready

`mark_ready` approves each entry and section for the next release. It does not change the live site yet. It needs an owner or an agency admin.

Mark ready every sample entry and every section that has its required fields. Report any refusal. A refusal that names languages means a language is still missing: fill it, then try again.

## 5. Ask, then go live

Before you call `go_live`, ask the user:

> "Go live now in demo mode? This publishes N entries and M sections to the demo release. Visitors do not see it. Shall I continue?"

Only continue on a clear yes. `go_live` needs "Allow going live" on the connection, or an owner or agency admin. If the connection lacks it, ask the user to press **Go live** in the CMS, and wait for them.

When you have the yes, call `go_live` with a short note, for example "Quickstart first release". It returns `publicationId` and `jobId`.

## 6. Wait for the build

Poll `get_build_job` with the `jobId`. Wait about 10 seconds between calls.

- Active statuses: `queued`, `building`, `validating`, `deploying`. Keep polling.
- Final statuses: `succeeded`, `failed`, `cancelled`. Stop.

Stop after about 5 minutes. Then ask the user to look at the release in the CMS.

On `failed`, read `error` and show it to the user. Common causes are a required section that is not ready, or a schema problem. Fix the cause with the user's yes, then start again from step 4.

Also call `get_release_status` once at the end. Check that `pendingChanges` is empty.

## 7. Pull

Run the pull directly. The schema is already in `areca.config.ts` from step 4b, so there is no need for `manifest pull` here:

```bash
<pm> exec areca pull --out src/generated/content
```

Expect output like:

```text
Pulled publication <id> (<hash>): posts=3, authors=2, ...
Types: src/generated/content/areca.gen.ts
```

- The `Types:` line means `areca.gen.ts` now exists. Tell the user to commit it.
- A `Warning:` line about an older publication means it was built before the schema was embedded. Ask the user to go live again.
- Without a terminal, `manifest pull` stops only when the pull would remove something: a collection, section, field, language, or the main language. It names the removal and asks for `--yes`. Then tell the user the removal you expect (from the plan), and ask for a yes. Use `--yes` only after that yes. Or ask the user to run `<pm> exec areca manifest pull` in their terminal, where it prints the diff and asks. Additions and changes apply without a question.
- A config without the header (see step 8.0) stops once even when nothing is removed. This is the one-time upgrade. Use `--yes` only after the user says yes.

## 8. Verify

Run these checks in order. Stop at the first failure and report it.

0. The one-command flow. Run `<pm> run content:sync </dev/null` once. It runs `areca manifest pull`, then `areca pull`. Expect `./areca.config.ts is already up to date` and then the pull output. Without a terminal, the manifest pull never waits for a key. If something would be removed, it stops with an error that names the removal. Then show the user the `-` lines of the diff and ask before you add `--yes`.
   - A config written by `areca manifest pull` has the header ``// Generated by `areca manifest pull`.``. Only removals ask for a yes.
   - A config from an older SDK has no header. The first run stops once with `already defines N collection(s). Re-run with --yes to overwrite it.`. Ask the user for a yes, then run `<pm> exec areca manifest pull --yes` once. After that the file has the header.

1. Typecheck. The first time, this is after the pull: `areca.gen.ts` is written by the pull. For TanStack, generate the route tree first (`<pm> run generate-routes`, or `<pm> exec tsr generate`). Then use the project's script, or `<pm> exec tsc --noEmit`. Expect no errors in the new files.
2. Build. `<pm> run build`. Expect success. If the build reads content, it must find the pulled files.
3. Dev server. Start it with `<pm> run dev` in the background. Use the port from step 0.
4. Pages. For each list route (for example `/blog` and `/vacancies`, and their Dutch versions `/nl/blog` and `/nl/vacatures`), check that it returns `200`. For each sample entry, request its page and check the status:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:<port>/blog/sample-our-first-post
   ```

   Expect `200`. Check that the sample title appears in the HTML:

   ```bash
   curl -s http://localhost:<port>/blog/sample-our-first-post | grep -c "Our first post"
   ```

   Do this for one page of each list and each detail route. Use the real route from the plan.
5. Home and about pages: `200`, and the hero or heading text from the sections.
6. Health route (only if it was added): `curl -s http://localhost:<port>/api/health` should show `"ok":true` and a `publicationId`.
7. Preview (only if it was added): open the URL that `get_preview_url` returns for a sample entry. It needs the production URL in the CMS to be the local dev URL. Expect the page to show a draft banner or the draft text.
8. Stop the dev server when you are done, unless the user wants it running.

Report the results in a short list: what passed, what did not, and the URLs you checked.

## 9. The samples

Ask the user:

> "Keep the sample entries as examples for your editors, or archive them?"

- **Keep:** leave them. Tell the user to edit or delete them in the CMS when the real content is ready.
- **Archive:** call `archive_entry` only after a yes. It needs an owner. Archived entries leave the live site at the next go live.
- Do not delete anything. Delete is not part of this skill.

## Code-first (without MCP)

Without MCP, the agent cannot create entries or mark them ready. The user does that in the CMS:

1. Ask the user to open the site in the CMS and create one sample entry per collection (the title, or the main text field, starts with `[Sample]`).
2. Ask the user to fill in the required sections (site content) in the CMS.
3. Ask the user to mark the entries ready, and then to go live in demo mode from the **Go-live panel**.
4. When the user says it is done, run `<pm> run content:pull`, then do the checks in step 8.

If the schema was written in code, `areca pull` works after the release.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `No publication exists for this site. Publish content in the CMS before running areca pull.` | No release is live. Finish steps 4 to 6, then pull. |
| `401` on pull, manifest pull or push | The token is wrong, rotated, or the wrong kind. The pull and the manifest pull use the site token. The push needs the schema token. Check the length with the step 0 check. Rotate in **Settings › Developer** if needed, then update `.env.local`. Restart the dev server after a change, because env files load at start. |
| `403` with `mfa_required` | The agency admin must turn on two-factor authentication. Schema and language tools are blocked until then. |
| Go live is refused because a required section is not ready | Fill the required fields with `update_global`, then `mark_ready` the section. |
| `Removing <key.field> deletes content` or `FieldDropsRequiredError` | Nothing was pushed. Show the list to the user. Only confirm with their explicit yes, using `--confirm-drop <key.field>`. |
| `Publication does not match its schema` | An entry breaks the schema. The message names the entry and field. Fix the entry, go live again, then pull. Nothing was written. |
| `No content file for collection "<key>"` | Run the pull. Check the key: a `blog-posts` key is read as `blogPosts` in code. |
| `Expected publication X, received Y` | `ARECA_SNAPSHOT_ID` is set in the environment. Unset it for local work. It is for pinned builds only. |
| `Failed to load TypeScript config … Use Node.js 22.18 or newer, or retry with tsx` | Upgrade Node, or run the command through `tsx`: `<pm> exec tsx ./node_modules/@areca-cms/site-sdk/dist/cli.js pull`. |
| Build fails with a missing module under `src/paraglide` | The Paraglide compile did not run before the pull. Run the compile first, as in [frameworks.md](frameworks.md). |
| `areca manifest pull` says "Remove … Re-run with --yes to confirm" | The pull would remove a collection, section, field, or language. It is not a terminal, so it cannot ask. Show the user the diff (run it in their terminal), then confirm. Use `--yes` only after the yes. |
| `areca manifest pull` says it "already defines N collection(s). Re-run with --yes" | The config was not written by `manifest pull` (no header) and it has collections. N counts the site content sections too. Show the user the diff, then confirm as above. After the one-time `--yes`, the header is there and only removals ask. |
| Preview link shows "expired" or "invalid" | Preview links last about an hour. Create a new link with `get_preview_url`. |
| `Something went wrong on the Areca server (ref …)` | Nothing is confirmed saved. Retry once, then report the ref to the user. |
| Pages show no content after the pull | The dev server started before the pull. Restart it. Check that `src/generated/content/manifest.json` has a `publicationId`. |
