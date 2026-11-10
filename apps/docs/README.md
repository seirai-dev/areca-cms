# Areca CMS docs

The public documentation site for Areca CMS, at [docs.arecacms.com](https://docs.arecacms.com): the CMS, the site SDK, self-hosting and security.

It is a standalone app (Fumadocs on TanStack Start) that shares no code with the CMS or SDK. It builds to plain static files, so the live site is read-only: there is no admin, login or database. Pages are Markdown files in this repository, and only people who can push to the repo can change them.

```bash
pnpm --filter @areca/docs dev       # http://localhost:3100, live reload
pnpm --filter @areca/docs build     # static site in dist/client
pnpm --filter @areca/docs preview   # serve dist/client like production
```

## Editing a page

Every page is one file under `content/docs/`. The URL follows the file path:

| File                                      | URL                        |
| ----------------------------------------- | -------------------------- |
| `content/docs/(start)/index.mdx`          | `/docs`                    |
| `content/docs/(start)/quickstart.mdx`     | `/docs/quickstart`         |
| `content/docs/sdk/cli.mdx`                | `/docs/sdk/cli`            |
| `content/docs/self-hosting/index.mdx`     | `/docs/self-hosting`       |

A folder name in parentheses, like `(start)`, groups pages without adding to the URL.

Open the file, change the Markdown and save. `pnpm dev` reloads instantly. Deploy to publish.

## Adding a page

1. Create `content/docs/<section>/<slug>.mdx`:

   ```mdx
   ---
   title: Webhooks
   description: One sentence shown under the title, in search results and link previews.
   ---

   Your content here.
   ```

2. That's it. The page appears at the end of its section's sidebar. To put it somewhere specific, add the slug to `pages` in that folder's `meta.json`.

## Sidebar and sections

Each top-level folder is a section, shown in the switcher at the top of the sidebar. Its `meta.json` controls the title, icon and page order:

```json
{
  "title": "SDK & API",
  "description": "Connect a website to Areca",
  "icon": "Code",
  "root": true,
  "pages": ["index", "---Guides---", "installation", "pulling-content", "..."]
}
```

- `"---Guides---"` adds a heading to the sidebar.
- `"..."` means "every other page in this folder, alphabetically". Keep it last so new files never go missing.
- A subfolder becomes a collapsible group. Give it its own `meta.json` with a `title`.
- `icon` takes any [Lucide](https://lucide.dev/icons) icon name. It works in page frontmatter too.

To add a whole new section, create a folder with a `meta.json` containing `"root": true`, and add the folder name to `content/docs/meta.json`.

## Writing components

Plain Markdown works everywhere: headings, lists, tables, links, images and fenced code blocks with syntax highlighting. These components are also available without importing anything:

```mdx
<Callout>A neutral note.</Callout>
<Callout type="warn" title="Before you upgrade">Back up the database first.</Callout>
<!-- types: info, warn, error, success, idea -->

<Steps>
<Step>

**Install the SDK.** Blank lines around the content let you use Markdown inside.

</Step>
<Step>

**Run the init command.**

</Step>
</Steps>

<Tabs items={['pnpm', 'npm']}>
  <Tab value="pnpm">`pnpm add @areca-cms/site-sdk`</Tab>
  <Tab value="npm">`npm install @areca-cms/site-sdk`</Tab>
</Tabs>

<Cards>
  <Card title="CLI reference" href="/docs/sdk/cli">Every command and flag.</Card>
</Cards>

<Accordions>
  <Accordion title="Why is my page blank?">Because…</Accordion>
</Accordions>

<TypeTable
  type={{
    siteKey: { type: 'string', description: 'The site identifier.', required: true },
    timeoutMs: { type: 'number', description: 'Request timeout.', default: '10000' },
  }}
/>

<Files>
  <Folder name="content" defaultOpen>
    <File name="manifest.json" />
  </Folder>
</Files>
```

Code blocks can have a title: ` ```ts title="areca.config.ts" `.

Images go in `public/` and are referenced from the root, e.g. `![Releases](/screenshots/current-releases.png)`. Readers can click an image to zoom.

## Links

Link to other pages with absolute paths, e.g. `[the CLI](/docs/sdk/cli)` or `[rate limits](/docs/security/rate-limits#site-api)`. **The build fails if an internal link points to a page that doesn't exist**, so broken links cannot reach production.

## What the build produces

- An HTML page for every doc, plus the landing page (`src/routes/index.tsx`) and a 404 page.
- `/docs/<page>.md`: the raw Markdown of each page, behind the "Copy Markdown" button.
- `/llms.txt` and `/llms-full.txt` for AI tools, plus `/sitemap.xml` and `/robots.txt` (see [SEO](#seo)).
- `/api/search`: a static search index, searched in the browser (⌘K).

## SEO

Every route sets its head with one call to `seo()` from `src/lib/seo`: title, description, canonical, link previews and structured data. Site-wide facts are in `src/lib/seo/config.ts`.

For doc pages, the frontmatter `title` and `description` become the meta tags, so write the description as a real sentence of 70–160 characters.

`sitemap.xml`, `robots.txt` and `llms.txt` are generated on build from the built pages by `scripts/seo.mjs`, which also fails the build on SEO errors (a missing title, description or canonical). To see every page and the generated files:

```bash
pnpm --filter @areca/docs seo:check
```

## Configuration

`src/lib/shared.ts` holds the site name and GitHub settings. Set `editLinks: true` once the repository is public to show "Edit on GitHub" on every page. The brand colours and fonts are in `src/styles/app.css`.

## Deploying

The output in `dist/client` is static, so any static host works (Cloudflare Pages, Netlify, S3, nginx). Configure the host to serve `/404/index.html` for unknown paths.

The Docker image serves the site with nginx on port 8080:

```bash
docker build -f apps/docs/Dockerfile -t areca-docs .   # from the repository root
docker run -p 8080:8080 areca-docs
```

Point your docs subdomain (e.g. `docs.example.com`) at the container or host. The site needs no environment variables and makes no calls to the CMS.

### docs.arecacms.com

The official site runs on Cloudflare Workers with static assets, configured in [`wrangler.jsonc`](wrangler.jsonc). Maintainers deploy it from the repository root:

```bash
pnpm cf:build:docs     # build, and copy the 404 page to where Cloudflare looks for it
pnpm cf:preview:docs   # upload a preview version without making it live
pnpm cf:deploy:docs    # publish to docs.arecacms.com
```
