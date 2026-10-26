# Interview

Ask four batches, one at a time. Wait for the answer before you ask the next batch.

Rules for every batch:

- Number the questions. The user answers by number, for example "1 yes, 2 nl, 3 defaults".
- Show the default in brackets for each question.
- Say that the user can reply `defaults` to accept every default in the batch.
- Skip a question when you already detected the answer. Show the detected value and ask "correct?" instead.
- Keep each question to one line where you can.

## Batch A: Project

Send this when step 0 is done. Fill in the detected values.

```text
A. Project

1. CMS URL? [detected: https://cms.example.com, or none. Local dev: http://localhost:3000]
2. Site key (the CMS slug, lowercase, e.g. acme-site)? [detected: from areca.config.ts, or ask]
3. Does this site exist in the CMS yet? [no]
   If no, I will walk you through creating it. You will need the production URL field: use http://localhost:<dev port> for now.
4. Framework: <detected>. Correct? [yes]
5. Package manager: <detected>. Correct? [yes]
6. Dev port: <detected, e.g. 3001>. [keep]
7. Content folder for pulled content? [src/generated/content]
8. Types file (areca.gen.ts)? [src/generated/content/areca.gen.ts]
9. Commit the generated types file? [yes; the pulled JSON stays out of Git]
10. Download images and files into the repo on pull? [yes]
    10a. Folder for them? [public/areca]
    10b. URL path the site serves that folder from? [only asked when the folder is not under public/]
11. Schema source: connect the CMS over MCP (the schema is created in the CMS, then saved to areca.config.ts) or write areca.config.ts in code? [MCP, if you are an agency admin; otherwise code]

Reply "defaults" to accept all of A.
```

Notes for the agent:

- Q3: if the site does not exist, read the "Create the site" section of `connect.md` before you go on.
- Q11: if MCP is not connected, ask only this: "Do you want to connect the CMS over MCP now?" If yes, go to step 1. If no, code.
- If the CMS URL is `localhost`, say that a remote CMS needs its own site token.

## Batch B: Content model

Ask what the site needs. Then go through each item with its recipe in `recipes.md`.

```text
B. Content model

1. What does the website need? Name the content in your own words.
   Examples: blog posts, team members, vacancies, services, case studies, events, FAQ.
2. Which company pages does the site need?
   [company info, home page, about page, footer]
3. Do you want any of these extras? [all yes]
   a. Categories for blog posts (a collection)
   b. Authors for blog posts (a collection, used as a reference)
   c. Departments for vacancies (a collection, used as a reference)
   d. Navigation links (a collection, see the note in recipes.md)
   e. SEO on the home and about pages (on by default)
4. Routes: each collection gets a route. These are the defaults from the recipe, for example /blog/$slug and /vacancies/$slug. Change them?
5. Anything that does not fit the recipes? Describe the fields in your own words. I will map them to field types.

Reply "defaults" to accept the recipe fields and all the extras in B.
```

For each item the user names:

1. Find its recipe in `recipes.md`. If no recipe fits, build one from the field types in `areca-sdk`.
2. Show the default fields in a short list. Ask: "Keep these, add, or remove?" Ask only one question per item.
3. Note the translatable choice for each text field. Use the recipe defaults.

Do not invent extra fields. Add what the user asked for and the recipe defaults.

## Batch C: Languages

Skip this batch when the user said "single language" in batch B or when the project has no i18n. The default is one language.

```text
C. Languages

1. One language or several? [one]
2. If several: the main language (the fallback) and all languages in display order?
   [main: <detected or en>, all: <main> only]
3. Route for each collection in each extra language. Default: the same route in every language. The site adds the language prefix itself (for example /nl/blog/...). Ask per collection only when the user wants different words, for example /journal in English and /journaal in Dutch.
4. Which languages must be complete before an item can be marked ready? [all extra languages, for every collection and section]
5. Which fields are the same in every language (names, prices, contact details, URLs, emails)? [the recipe defaults]
6. i18n approach:
   - If the project already uses a library, use it. Only Paraglide is wired by the SDK. For another library, the content is read with an explicit locale.
   - If the project has none: Paraglide is recommended. It needs a new package. Install it only if you say yes.
   [Paraglide]

Reply "defaults" to accept all of C (one language, so C is skipped).
```

Notes for the agent:

- Languages cannot be turned off once set in the CMS. Say so before Q2 is confirmed.
- Do not install any i18n library without a yes to Q6.

## Batch D: Build and preview

```text
D. Build and preview

1. Pages for each collection:
   a. Connect to existing pages. I change the data source only.
   b. Build simple pages (list and detail) using the site's own components. No styling beyond what the site uses.
   c. Skip for now.
   [b when the project has no pages for the collection, otherwise a]
2. Connect the home page and the about page to their sections? [yes, when the plan has them]
3. Draft preview route (so editors can see drafts in the site)? [yes]
   It needs the production URL in the CMS. A localhost URL is fine for development.
4. Run a content pull before every build and before the dev server? [yes, prebuild only; predev only after the first release]
5. Will you deploy with go-live builds (Dokploy) later? [no]
   If yes, I add the health route now. Read the areca-sdk skill, references/production.md.
6. First release mode: demo or production? [demo]
   Demo does not deploy and never shows to visitors. Production needs a deployment target and a health check URL. Use demo for the first release.

Reply "defaults" to accept all of D.
```

## Plan format

After batch D, show the plan. Keep it short. Then ask: "Reply yes to confirm, or tell me what to change."

```text
Plan

Project
- Framework: TanStack Start, pnpm, dev port 3001
- Site key: acme-site (exists in the CMS: yes)
- CMS: https://cms.example.com (schema over MCP)

Content folder
- src/generated/content (types committed, media in public/areca, downloaded on pull)

Collections
- posts: /blog/$slug, 9 fields, author -> authors
- authors: /team/$slug, 5 fields
- ...

Sections
- companyInfo (no SEO), homePage (SEO, preview /), aboutPage (SEO, preview /about)

Languages
- none, or: en (main), nl. Routes: /blog/$slug and /nl/blog/$slug. Required: nl.

i18n
- none, or Paraglide (needs your yes to install)

Pages
- posts: list and detail, simple pages
- home and about: connected to their sections

Preview route: yes. Prebuild pull: yes.
First release: demo mode.
```

Keep the plan to the facts. Mark every item the user has not confirmed.

## Recording answers

Keep the answers in your working notes for the rest of the run. Re-read them before step 3 and step 4. If the user changes an answer later, update the plan and show the changed lines only.
