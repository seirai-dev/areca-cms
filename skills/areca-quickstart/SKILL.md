---
name: areca-quickstart
description: Sets up Areca CMS in a new or existing website project for a web agency. Detects the framework, interviews the user, creates the content model over MCP or in code, wires the site and publishes a first release. Use when the user wants to set up, connect or integrate Areca CMS, run the quickstart, add Areca to a website, or add collections like blog or vacancies.
license: MIT
metadata:
  version: "0.5.0"
---

# Areca quickstart

This skill sets up Areca CMS in one website project. You detect what the project already has, ask the user a few questions, then do the work. The user is an agency. The website is for one client.

The skill runs in two modes:

- **New setup:** no Areca files exist yet. Go through steps 0 to 7.
- **Re-run:** Areca is already set up. Go to [Re-run mode](#re-run-mode).

Plain steps, in order:

0. Detect the project.
1. Check the MCP connection.
2. Interview the user (four batches).
3. Show the content model and wait for approval.
4. Connect the project and create the schema.
5. Wire the project (scripts, framework, languages, pages).
6. Make the first release, pull the content and verify.
7. Summarise and hand over.

Keep the details in the reference files:

- [references/interview.md](references/interview.md): the question batches and the plan format.
- [references/recipes.md](references/recipes.md): collection and section recipes with fields.
- [references/connect.md](references/connect.md): MCP connection, creating the site, tokens, demo mode.
- [references/frameworks.md](references/frameworks.md): wiring code for TanStack Start, Next.js, Astro and plain Node.
- [references/first-release.md](references/first-release.md): sample entries, release, pull, checks and troubleshooting.

For API detail, read the `areca-sdk` skill (config, fields, CLI, content API) and the `areca-mcp` skill (tools, roles, workflow). Do not copy their detail into the project. Name the skill and use what it says. If those skills are not installed, read the docs in the `skills/` folder of https://github.com/ekozf/areca-cms instead.

## Ground rules

- Never delete a collection, field, section or language without explicit confirmation from the user.
- Never run `areca init --force`. It replaces `areca.config.ts` with an empty config.
- Never call `go_live` on your own. Ask first, every time. The same goes for `schedule_entry`, `rollback` and `set_publishing_mode`.
- Never confirm a field drop with `--yes` or `--confirm-drop` on your own.
- Never ask for a token or key in chat. Never print a token. See [Secrets](#secrets).
- Never install a package you were not asked to install. This includes an i18n library. Ask first.
- Confirm before you overwrite an existing file, or change an existing `package.json` script that is not ours.
- Do not experiment on a live production site. For a site that is already live, work in its development environment (see [Live site with a development environment](#live-site-with-a-development-environment)). If it has none, use hidden collections (`enabled: false`) or ask the agency to create one.
- Never push to production on your own. Push only after the user has seen the dry run list and approved it.
- Respect the user's choices. If they say no to MCP, use code-first. If they say no to a route, skip it.
- Show a plan before you write files, and wait for the user to approve the content model.

## Step 0: Detect the project

Read these. Do not change anything yet.

1. `package.json`: framework and scripts.
   - `@tanstack/react-start` means TanStack Start.
   - `next` means Next.js.
   - `astro` means Astro.
   - `vite` alone, or no framework, means plain Vite or Node.
   - Note the `dev` script and its port (for example `--port 3001`). If the script sets no port, use the framework's default and confirm it from the dev server output in step 6.
   - Note `packageManager` if it is set.
2. Lockfile, to find the package manager: `pnpm-lock.yaml` means pnpm, `package-lock.json` means npm, `yarn.lock` means yarn, `bun.lock` or `bun.lockb` means bun. If there is more than one, use the `packageManager` field. If there is still no answer, ask.
3. Areca state: does `areca.config.ts` exist? Is `@areca-cms/site-sdk` in `dependencies`? Does `src/generated/content/areca.gen.ts` exist? If any is true, use [Re-run mode](#re-run-mode).
4. i18n: look for `@inlang/paraglide-js` or `project.inlang/`, `next-intl`, `i18next` or `react-i18next`, `@lingui/*`, `vue-i18n`, or an `i18n` block in the framework config (for example `astro.config.mjs`). If none, the answer is "none".
5. Routes and pages: `src/routes/` (TanStack), `app/` or `src/app/` or `pages/` (Next), `src/pages/` (Astro). Note any blog, team or job pages that already exist.
6. Node version: run `node -v`. Areca needs 22.6 or newer. Use 24 LTS if possible. Loading a TypeScript config needs 22.18 or newer, or `tsx`.
7. Env files: check whether `.env.local` exists and which keys it has. Never print values. For a token, print only its length:

   ```bash
   awk -F= '/^ARECA_(CMS_URL|SITE_TOKEN|SCHEMA_TOKEN)=/{print $1, "length", length($2)}' .env.local 2>/dev/null
   ```

8. Git: run `git status --short`. If the project is not a git repo, say so and offer `git init` before you write any file. If the tree has unrelated changes, tell the user before you start.

No framework yet (no `package.json`, or no framework in it)? Say so. Offer to scaffold a TanStack Start app with `pnpm dlx @tanstack/cli@latest create` (not `create-tsrouter-app`). Then continue from step 0 in the new project. This skill does not cover the scaffold itself.

Report what you found in a short list. Ask only about what you could not detect. Go to step 1.

## Step 1: Check the MCP connection

The Areca MCP server gives the agent its own tools. Look for a tool named `get_site_info` from an Areca server. The name may carry a prefix such as `mcp__areca-<slug>__get_site_info`.

- **Connected:** call `get_site_info`. Read `you.role`, `cannotDo`, `site.publishingMode`, `site.environment`, `site.devEnvironment`, `collections`, `globals` and `languages`. If the site has gone live or `site.devEnvironment` is set, read the live-site section below before you write anything.
  - Role **agency admin**: the schema can be created over MCP (MCP-first, the default).
  - Any other role: the schema must be created in code (code-first). Say why. Owners and editors cannot change the schema over MCP.
- **Not connected:** ask the user whether they want to connect. Explain what you need: the CMS URL and the site slug. The connector URL is `<cms-url>/api/mcp/<site-slug>`. Explain the sign-in (a browser opens on first use). Read [references/connect.md](references/connect.md) for the exact steps per app. Tell the user that the agent session may need a reload or restart after the connector is added.
- **Declined, or not possible now:** code-first. Say so once and move on.

If the site does not exist in the CMS yet, the user must create it in the CMS. Read the "Create the site" section in [references/connect.md](references/connect.md). Do not guess a site key or a token.

## Step 2: Interview the user

Read [references/interview.md](references/interview.md). It has four batches: A (project), B (content model), C (languages) and D (build and preview). Ask one batch at a time. Each batch has defaults and an "accept all defaults" reply.

- Use the detected values as defaults. Do not ask again what you already know.
- Record the answers. After batch D, show the plan in the format from `interview.md`. Ask the user to confirm it.

## Step 3: Show the content model and wait for approval

The approval in this step covers every MCP write and every file write that follows. Record it in your notes before you call any write tool, including `set_site_languages`. No recorded yes, no write.

For each collection and section in the plan, build the schema from [references/recipes.md](references/recipes.md). Show one table per collection or section:

| Key | Type | Required | Translatable | Notes |
| --- | --- | --- | --- | --- |

Also show the route for each collection (for example `/blog/$slug`) and the SEO setting for each section. When an extra was declined, show the fields that were removed because of it, in the table, for example a row "removed: author (authors declined)".

Ask: "Shall I create this content model?" Wait for a yes. If the user changes something, update the plan and show the changed tables again. Do not create anything before approval.

## Step 4: Connect the project and create the schema

Record the Step 3 approval before any MCP write, including `set_site_languages`.

### 4a. Install, init and tokens

1. Install the SDK with the detected package manager: `pnpm add @areca-cms/site-sdk`, `npm install @areca-cms/site-sdk`, `yarn add @areca-cms/site-sdk` or `bun add @areca-cms/site-sdk`. Skip this if it is already there.
2. Run `areca init` once. Use one of these two ways.
   - **Preferred:** ask the user to run `<pm> exec areca init` in their own terminal. It asks for the CMS URL, the site token and the site key. The token prompt hides what is typed. Wait for the user to say it is done.
   - **Alternative:** if the user is fine with it, the user first puts `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` in `.env.local` (you do not paste the token). Then run the non-interactive form, with the URL and site key from the plan:

     ```bash
     <pm> exec areca init --yes --cms-url <url from the plan> --site-key <site key from the plan> --token "$(sed -n 's/^ARECA_SITE_TOKEN=//p' .env.local)"
     ```

     Do not echo the command with the token in it. The `--token` flag is visible to other users on the machine for a moment. Mention that.
3. `init` writes `areca.config.ts` (if missing), `.env.example`, `.env.local`, `.gitignore` entries, `src/generated/content/manifest.json` and the scripts `sync-manifest` and `content:pull`. It also wraps `dev` in `areca run --` unless the script already loads env files. It does not install packages and does not add `areca.gen.ts`. Check the result with `git diff` and show the user a short list.
   - `init` prints code-first next steps (`sync-manifest`, then publish). Ignore that text when you go MCP-first. The schema comes from MCP, and `sync-manifest` is not used.
4. Schema token (code-first only): the user adds `ARECA_SCHEMA_TOKEN=` to `.env.local` themselves, from Settings › Developer › Schema-write token. MCP-first does not need it.
5. Check the tokens with the length check from step 0. Do not print them. If a value is empty, say which key is empty and where to paste it. Continue only when the needed keys are set.
6. `.env.local` is gitignored. Leave its file permissions as they are. Do not run `chmod` on your own. If the user asks for stricter permissions, `chmod 600 .env.local` is the usual choice.

### 4b. Create the schema

**MCP-first (default when the role is agency admin):**

1. Call `get_site_info` again. Check that the site matches the site key in the plan.
2. If the plan has languages, call `set_site_languages` with `main` and `all`. Tell the user that languages cannot be turned off once set. Ask first if that was not already clear in the plan.
3. For each collection, call `get_collection_schema` for an existing one. Then call `upsert_collection` with `key`, `label`, `routePattern`, the full `fields` list, `requiredLanguages` and `routes` when needed. Fields replace the whole list, so always send every field. A `slug` field is added when missing, but include it anyway.
4. For each section, call `upsert_global` with `key`, `label`, the full `fields` list, `seo` and `previewPath`.
5. Call `get_site_info` again and compare with the plan. Report any difference.
6. Pull the schema into the project: `<pm> exec areca manifest pull`. This writes `areca.config.ts` from the CMS, so the schema is in Git. A file it wrote before (it starts with the header `// Generated by \`areca manifest pull\`.`) asks only before a removal (a collection, section, field, language, or the main language). If it stops for a removal, show the user the diff and get a yes. Then follow [first-release.md](references/first-release.md) (section 7) before you add `--yes`. A file without the header that already has collections (for example from an older SDK) asks once. With the user's yes, run `<pm> exec areca manifest pull --yes` once.

`manifest pull` rewrites the config file. Keep hand edits out of it. It keeps `siteKey`, `assets` and `i18n`.

**Code-first (fallback):**

1. Write `areca.config.ts` from the approved plan. Use `defineSiteContent` from `@areca-cms/site-sdk`. Use the field rules and the reserved names from the `areca-sdk` skill. Add `languages`, `i18n.paraglide` and `assets` only when the plan says so. Confirm before you overwrite a config that already has collections.
2. Check that the user has `ARECA_SCHEMA_TOKEN` set (step 4a.5).
3. Run `<pm> exec areca manifest push`. A push disables collections that are not in the config. If the CMS says a removed field still holds content, the push stops. Show the list to the user and ask. Do not add `--yes`.

If an MCP-first or code-first step fails, read the error and the `areca-sdk` or `areca-mcp` skill. Tell the user what failed. Do not try a different path without asking.

## Step 5: Wire the project

Do these in order. Show the user each file you will change before you change it when the file already exists.

1. **Scripts** in `package.json`. Keep the scripts `init` added. Add these, using the detected package manager:
   - `content:sync`: `areca manifest pull && areca pull --out src/generated/content` (MCP-first). It asks only before a removal. A config from an older SDK (no header) asks once: see step 4b.6.
   - `sync-manifest` (`areca manifest push`, needs `ARECA_SCHEMA_TOKEN`) is for code-first only. In MCP-first, leave it in place and tell the user it is not used.
   - `prebuild`: `areca pull` (plus the Paraglide compile first when Paraglide is used). A build without content fails until the first release exists. That is expected.
   - `predev` (optional): only after the first release. A failing `predev` stops the dev server.
   - Do not change `dev` again. `init` already wraps it in `areca run --` when needed.
2. **Languages** (only if the plan has them). Set `languages` in `areca.config.ts` through MCP or by code. Set up Paraglide only if the user agreed to it. Install it only after approval. For TanStack Start the Paraglide recipe in [references/frameworks.md](references/frameworks.md) was verified end to end; follow it. Other i18n libraries: pass the locale yourself with `content.in(locale)`.
3. **Framework wiring**: read the section for the detected framework in [references/frameworks.md](references/frameworks.md). Add:
   - a server-only content module (the code imports `content` from `areca.gen.ts`),
   - list and detail pages for each collection in batch D,
   - head tags from `seoHead` or `seoHeadHtml`,
   - the home and about pages when they are in the plan,
   - a preview route when the user asked for it,
   - a health route only when the user plans go-live builds.
4. **Existing pages**: when the user chose "connect into existing pages", change only the data source. Keep the markup and styles. Show the diff.
5. **Build output**: keep `src/generated/content/*.json` out of Git. The `.gitignore` entries from `init` do that. Commit `areca.gen.ts` once it exists. Do not commit unless the user asks.

Do not render CMS content in browser code. The SDK content object and tokens are server-only. Use the framework's server functions, server components or build-time code.

## Step 6: First release, pull and verify

Read [references/first-release.md](references/first-release.md). The short version:

1. Check the publishing mode. Use demo mode for the first release. Production needs the user's explicit choice, and a site that already went live in production must not get sample content (see first-release.md, section 1).
2. Create one sample entry per collection, in dependency order (authors before posts, for example). The title starts with `[Sample]`, or the main text field when there is no title. Fill the SEO fields. Fill the main language and each required language.
3. Fill each required section with `update_global`. Use the real company details from the interview. For other copy, write short placeholder text and say so.
4. Mark everything ready. Tell the user what you are doing.
5. Ask: "Go live now in demo mode? This publishes N entries and M sections." Wait for a yes.
6. Go live, then poll `get_build_job` until the job is done. If the agent has no go-live permission, ask the user to press Go live in the CMS and wait for them.
7. Pull: `<pm> exec areca pull --out src/generated/content`. Use the direct command, not the `content:sync` script. The script also runs `manifest pull`, which stops without a terminal when that pull would remove something. Expect `Pulled publication …` and a `Types:` line.
8. Verify: typecheck, build, start the dev server, and check that a sample page returns HTTP 200 and shows its title. Use the checks in the first-release reference.
9. Ask the user whether to archive the sample entries or keep them as editor examples. Do not archive without a yes.

If the user has no sample to show, or the build fails for a reason you cannot fix, stop and report the exact error.

## Step 7: Finish

Give the user a short summary with this shape. Keep it plain.

```text
Areca CMS is set up in <project path>.

Created in the CMS:
- Collections: <key> (<route>), ...
- Sections: <key>, ...
- Languages: <main> (main), <others> | none

Files changed:
- areca.config.ts, .env.local (tokens: not shown), .gitignore
- src/generated/content/areca.gen.ts (commit this)
- <pages and modules you wrote>

Keep content up to date:
- <pm> run content:sync    (MCP-first: pulls the schema and the published content)
- <pm> run content:pull    (code-first: pulls published content only)
- After you edit areca.config.ts by hand (code-first): <pm> run sync-manifest

Add more later: run /areca-quickstart again. It skips what is done.
Going live: see the areca-sdk skill, references/production.md (Dokploy builds and the health route).
Docs: https://github.com/ekozf/areca-cms
```

Remove lines that do not apply. Mention any step you skipped and why.

## Live site with a development environment

Use this when the site is already live, or when `get_site_info` on the production connector shows `site.devEnvironment`. Changes for a live site go to its development environment first. The user reviews them there, and only then are they pushed to production.

1. **Find the development environment.** On the production connector, `site.devEnvironment` gives its `connectorUrl`. Tell the user that the development connector is the place to work. If the site has none, ask the user whether an agency admin should create one. Only with the user's yes, and only from an agency admin connection on the production connector, call `create_dev_environment({ confirm: true })`. It never returns tokens.
2. **Connect the development connector.** The user adds it in Connect AI, as a second connector for the same site. The development connector is for agency admins only. Its URL is the production connector URL with `-dev` added after the site slug. If `get_site_info` on the connector you have shows `environment: "development"`, you are already on it.
3. **Set up the project for the development environment.** The user keeps the development site's token in `.env.local` as `ARECA_SITE_TOKEN`, and the development schema token as `ARECA_SCHEMA_TOKEN` for code-first sites. Only the user pastes them. The development site's tokens are shown once in the CMS, under Settings › Development. A pull with the development token reads its ready content directly, with no release. Entries show up in that pull once they are marked ready with `mark_ready`.
4. **Make the change on the development connector.** Edit with the MCP tools as in the `areca-mcp` skill, and keep the code changes in the project as usual.
5. **Check it locally.** Mark the new or changed entries ready and run `areca pull`. Never run `go_live` for this. A development environment has no go live.
6. **Push, with a review.** Call `push_to_production` with no arguments first. That is a dry run and writes nothing. Show the user `items` and `needsAttention`. Ask which items to leave out and which needs-attention items to apply. Only then call `push_to_production` with `dryRun: false`, the `planHash` from the dry run, and the user's `exclude` and `apply`. Ask the user separately before passing `goLive: true`. If the answer is "The plan changed", run the dry run again.
7. **Or push in the CMS.** The push screen in the CMS (the banner's **Push to production**) does the same review with switches. Use it if the user prefers, or if the agent cannot use the development connector.

Things to keep in mind:

- **Reset** with `refresh_from_production({ confirm: true })` discards every unpushed change. Run the dry run first, and get a yes from the user for the number it reports.
- **Code-first sites.** Before the schema goes to production with `sync-manifest`, run `<pm> exec areca manifest pull` with the development token in `.env.local`. This updates `areca.config.ts` to match the development environment, so the next manifest push does not undo the changes made in the CMS.
- **Production check.** To look at production locally, the user swaps the tokens in `.env.local` for the production values, pulls, checks, and swaps them back. Do not do this for them, and do not print the values.
- **One copy only.** A site has at most one development environment, and every agency admin shares it. Clients never see it.

## Secrets

- Never ask for a token, key or password in chat. If the user pastes one anyway, do not repeat it. Tell them to remove it from the chat and rotate it in the CMS.
- Tokens live in `.env.local`. Only the user pastes them there, or runs `areca init` in their terminal.
- Check that a value is set with the length check. Never print the value. Never write it into a file that Git tracks (`.env.example` has empty values only).
- The site token and the schema token are server secrets. Never use a `VITE_`, `NEXT_PUBLIC_` or `PUBLIC_` prefix for them.
- A personal MCP key (`areca_mcp_…`) follows the same rules. OAuth needs no key, so prefer it.

## Re-run mode

Use this when `areca.config.ts`, the SDK dependency or `areca.gen.ts` already exists.

1. Do not install the SDK again. Do not run `areca init` again. Do not overwrite `.env.local`.
2. Show the current state: collections and sections from `areca.config.ts`, or from `get_site_info` if MCP is connected. Note the languages, the publishing mode and whether a development environment exists.
3. Decide the schema source from the header of `areca.config.ts`:
   - It has the header `// Generated by \`areca manifest pull\`.`: **MCP-first**. Change the schema with MCP (`upsert_collection`, `upsert_global`, `set_site_languages`) after the approval. Then run `<pm> run content:sync </dev/null`.
   - Anything else: **code-first**. Edit `areca.config.ts` after the approval. Then run `<pm> run sync-manifest` (needs `ARECA_SCHEMA_TOKEN`), then `<pm> run content:pull`.
   This is how to read the `areca-mcp` advice "if the site syncs its schema from code, prefer areca.config.ts": the header tells you which kind of site it is. Do not switch a site from one kind to the other without asking the user.
4. Ask what the user wants to add or change. Typical requests: a new collection (for example vacancies), a new field, a new language, a new page.
5. For new or changed parts, go through the same flow: the interview questions that apply, the approval gate (step 3), the schema (step 4b), the wiring (step 5), and a release (step 6). Skip the parts that are done.
6. For removals, fields that hold content, or languages: explain what is lost. Get explicit confirmation before any change.
7. For an existing live site, follow [Live site with a development environment](#live-site-with-a-development-environment). Never write experiments straight into production.
8. Finish with the step 7 summary, only for the parts that changed.
