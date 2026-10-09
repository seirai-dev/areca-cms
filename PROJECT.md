# Original project proposal

This document preserves the initial design discussion and proposed scope. It is historical context, not a guide to the current implementation. Start with [the documentation index](docs/README.md), [architecture](docs/ARCHITECTURE.md), or [implementation status](docs/MVP_STATUS.md) for current behavior.

Yes—your idea makes sense. In fact, it addresses a real gap between:

- Traditional headless CMSs, which usually require runtime API requests
- Git-based CMSs, which often assume a specific framework or repository workflow
- Visual site builders, which usually control the entire frontend
- Your agency workflow, where you control the components, routes, hosting, and deployment pipeline

What you are describing is not quite a conventional headless CMS. It is better described as a:

> **Schema-driven, build-time content platform for agency-managed websites**

Or:

> **A managed content CMS with build-time publishing**

The important distinction is that the CMS is used only for authoring and publishing. The public website consumes a versioned snapshot of the content during its build. Visitors do not contact the CMS for normal content pages.

---

# Your proposed architecture

```text
Customer editor
      │
      ▼
Your CMS control plane
      │
      ├── Stores drafts, revisions, users, assets, schedules
      ├── Validates content
      └── Creates a publish request
              │
              ▼
        Build queue
              │
              ▼
      Build worker for site
              │
              ├── Fetch published content snapshot
              ├── Validate content against site schema
              ├── Generate Markdown/JSON/content files
              ├── Run TanStack Start build
              ├── Run tests and checks
              └── Produce deployable artifact
                      │
                      ▼
                 Dokploy
                      │
                      ▼
              New website version
```

The public site then contains the content in its build output or application bundle:

```text
Visitor → Customer website → Already-built content
```

No CMS request is required for a blog page, vacancy page, article page, or similar route.

This is a perfectly valid architecture. It is essentially a combination of:

- A CMS
- A content compiler
- A build orchestrator
- A deployment adapter

---

# TanStack Start supports the model

TanStack Start has official support for static prerendering. Its prerendering system can generate static HTML files during the build, discover routes, crawl links, and render selected routes with configurable concurrency and retry behavior.

Source:

- [TanStack Start static prerendering](https://tanstack.com/start/latest/docs/framework/react/guide/static-prerendering)

TanStack Start also documents combining prerendered pages with dynamic server functionality. This fits your situation well:

```text
Static or prerendered content routes
+
Dynamic server routes and server functions
```

Your website does not need to be a completely static application. You can still have:

- Authentication
- Forms
- Server functions
- API routes
- Database access
- Admin functionality
- Personalized or request-specific functionality

while prerendering public content pages.

One important detail: dynamic routes such as:

```text
/blog/$slug
```

need their valid slugs supplied to the build process. Your content integration therefore needs to expose something like:

```ts
const posts = await content.getPublishedEntries('blog')
```

The build then uses those entries to generate the route list.

TanStack Start also supports server routes for external HTTP callers, which is useful for receiving webhooks or build callbacks:

- [TanStack Start server routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes)

---

# The main architectural choice: where does content live?

You have two sensible options.

## Option A: CMS database as the source of truth

```text
CMS database
      │
      ▼
Build worker fetches a content snapshot
      │
      ▼
Generated files are placed into the website build
```

For example:

```text
generated-content/
├── blog/
│   ├── first-post.json
│   └── second-post.json
├── vacancies/
│   └── frontend-developer.json
└── manifest.json
```

Advantages:

- Centralized multi-tenant architecture
- Easier customer management
- Easy to query and filter
- Easy to schedule
- Easy to manage assets
- No need to expose Git to customers
- Fits a SaaS-style CMS

Disadvantages:

- You need backups and migrations
- You need your own versioning system
- You need to make releases reproducible
- You need to preserve historical content snapshots

This is probably the best fit for your agency.

## My recommendation

Start with a database-backed CMS, but make every publication produce an immutable content snapshot.

Conceptually:

```text
Publication 1 → content snapshot A
Publication 2 → content snapshot B
Publication 3 → content snapshot C
```

A build should never simply ask:

```text
"Give me whatever content exists right now."
```

It should ask:

```text
"Build site X using publication snapshot Y."
```

That gives you:

- Reproducible builds
- Reliable rollback
- Auditable publication history
- Easier debugging
- Protection against content changing halfway through a build

For example:

```text
Site: customer-a
Release: 2026-09-01T18:30:00Z
Content snapshot: sha256:abc123
Code commit: 8e4a2f1
Deployment: Dokploy deployment 492
```

---

# What you need to build

## 1. Organizations and sites

Your primary model should probably be:

```text
Agency
└── Organization
    ├── Users
    ├── Sites
    ├── Enabled content types
    ├── Assets
    └── Publications
```

A single customer organization might eventually have multiple websites:

```text
Acme
├── acme.com
├── acme-careers.com
└── acme-foundation.org
```

The important distinction is between:

- Organization-level users and permissions
- Site-level configuration
- Content type availability
- Content entries
- Deployment targets

A content type might be enabled for one site but not another.

---

## 2. Schema and content-type registry

Your agency should define the available content types, rather than allowing customers to invent arbitrary frontend structures.

For example:

```text
Article
├── title
├── slug
├── excerpt
├── body
├── heroImage
├── author
├── categories
├── publishedAt
└── seo
```

The customer can customize entries inside this model, but cannot create a field that your frontend does not understand.

A useful distinction is:

### Global schema definition

Owned by your agency:

```text
Article has:
- title
- slug
- excerpt
- body
- hero image
- publication date
```

### Organization/site configuration

Controlled by you per customer:

```text
Customer A:
- Blog enabled
- Vacancies disabled

Customer B:
- Blog enabled
- Vacancies enabled
- Authors enabled
```

### Content values

Controlled by the customer:

```text
Article:
- title: "Our new office"
- body: ...
- publishedAt: ...
```

This gives you both flexibility and safety.

---

## 3. Site integration manifest

Each website should register itself with the CMS using a manifest.

For example:

```text
Site: customer-a
Framework: tanstack-start
Enabled content types:
- article
- vacancy
- event

Routes:
- article → /blog/:slug
- vacancy → /jobs/:slug
- event → /events/:slug

Build command:
- pnpm build

Deployment target:
- dokploy application ID
```

The manifest should be versioned with the website code, not only stored in the CMS. Otherwise, the CMS could believe a content type exists when the deployed frontend no longer supports it.

A conceptual TypeScript configuration might look like:

```ts
export default defineSiteContent({
  siteId: 'customer-a',
  collections: {
    articles: {
      route: '/blog/$slug',
      fields: articleFields,
    },
    vacancies: {
      route: '/jobs/$slug',
      fields: vacancyFields,
    },
  },
})
```

The CMS can then synchronize the available schema from the website or receive a controlled schema definition from your internal platform.

---

## 4. Content storage and publication states

Each entry should have at least:

```text
draft
published
scheduled
archived
```

You should separate the editable draft from the currently published version.

A simplified model:

```text
Entry
├── id
├── siteId
├── collection
├── slug
├── draftData
├── publishedData
├── status
├── scheduledAt
├── publishedAt
├── updatedBy
└── updatedAt
```

For stronger versioning:

```text
Entry
└── Revisions
    ├── revision 1
    ├── revision 2
    ├── revision 3
    └── revision 4
```

Publishing should create an immutable publication record:

```text
Publication
├── id
├── siteId
├── createdAt
├── contentSnapshot
├── requestedBy
├── buildStatus
├── deploymentStatus
└── deployedAt
```

---

## 5. Rich-text editor and content representation

Your idea of using a rich-text editor that serializes to Markdown is reasonable.

However, I would strongly consider storing a structured editor format as the canonical value and generating Markdown or HTML from it.

For example:

```text
Canonical content:
Tiptap JSON / ProseMirror JSON

Generated forms:
- Markdown
- HTML
- React rendering model
```

Advantages:

- Better validation
- Better handling of links and embedded media
- Easier migration between editor versions
- More control over allowed formatting
- Easier custom blocks

If you only store arbitrary Markdown, customers may eventually create content your renderer cannot safely handle.

A good approach is to restrict rich text to an allowlist:

```text
Allowed:
- headings
- paragraphs
- bold
- italic
- links
- ordered lists
- unordered lists
- quotes
- images
- code blocks

Not allowed:
- arbitrary HTML
- scripts
- custom React components
- uncontrolled iframes
```

You could support custom structured blocks later:

```text
Article body
├── paragraph
├── heading
├── image
├── quote
├── callout
└── related-content
```

This is more robust than allowing the customer to type arbitrary MDX.

---

## 6. Media management

You will need a proper asset system for:

- Images
- PDFs
- Videos
- Logos
- Documents
- Social-share images

Use object storage rather than storing large files directly in PostgreSQL.

Your asset system should include:

- Uploads
- Metadata
- Alt text
- Captions
- File type validation
- Size limits
- Usage tracking
- Image dimensions
- Thumbnails
- CDN URLs
- Replacement without breaking references

For example:

```text
Asset
├── id
├── organizationId
├── storageKey
├── originalFilename
├── mimeType
├── width
├── height
├── altText
├── focalPoint
└── createdBy
```

You should avoid making generated pages depend on temporary asset URLs. The build should resolve stable asset references.

---

## 7. Previewing

A blank reserved page is probably not the best preview model.

You have three better options.

### Option A: Draft preview against the real site code

The website has a protected preview route:

```text
https://customer-site.com/__preview/blog/my-draft
```

The route uses a signed preview token and loads draft content from the CMS.

This does involve a CMS request, but only for authenticated previews—not for public traffic.

Advantages:

- Fast feedback
- No full deployment required
- Uses the actual production components
- Simple to understand

### Option B: Preview build

When the editor clicks preview:

1. Create a temporary content snapshot.
2. Build the site using that snapshot.
3. Deploy it to a preview target.
4. Return a preview URL.

This gives the most accurate preview but is slower and more expensive.

### Option C: Hybrid preview

Use live draft fetching for ordinary content edits, and generate a preview deployment before final publishing.

This is probably the best long-term experience.

The preview system should use:

- Signed, expiring tokens
- Organization/site scoping
- Draft content access only
- Noindex headers
- Optional password protection
- Automatic expiration
- Clear preview build status

---

## 8. Build queue and release orchestration

You should not allow every save to trigger a build.

Use separate concepts:

```text
Save draft
    ↓
No production build

Publish requested
    ↓
Create release job
    ↓
Validate and build
    ↓
Deploy if successful
```

A queue item might contain:

```text
BuildJob
├── id
├── siteId
├── publicationId
├── priority
├── status
├── attempts
├── startedAt
├── finishedAt
├── logs
└── error
```

Useful statuses:

```text
queued
building
validating
deploying
succeeded
failed
cancelled
```

You should coalesce jobs intelligently:

```text
Publication A queued
Publication B queued
Publication C queued
```

If A and B have not started yet, you can often discard them and build only C, because C contains the latest complete content snapshot.

However, do not discard a release that is being audited or explicitly retained.

The “urgent” option should mean:

> Move this release to the front of the queue.

It should not mean:

> Skip validation and deployment safety checks.

---

## 9. Build worker

The build worker is one of the most important parts of your platform.

It should:

1. Load the exact site code version
2. Load the exact content snapshot
3. Generate content files or data modules
4. Validate content
5. Run the TanStack Start build
6. Run type checking and tests
7. Produce a deployable artifact
8. Upload or deploy the artifact
9. Record logs and metadata
10. Mark the release as live only after a health check succeeds

For example:

```text
site repository
        +
content snapshot
        ↓
build workspace
        ↓
generated-content/
        ↓
pnpm typecheck
pnpm test
pnpm build
        ↓
Docker image or deployment artifact
        ↓
Dokploy
```

Content should be injected into the build in a predictable way. Possibilities include:

```text
src/generated/content/*
```

or:

```text
content-snapshot.json
```

or:

```text
content/
├── articles/
├── vacancies/
└── events/
```

Your application integration should read from that local build-time source instead of calling the CMS.

---

## 10. Dokploy adapter

Dokploy supports programmatic deployment through its API. Its documentation describes using an API token and calling the application deployment endpoint.

The relevant endpoint is documented as:

```text
POST /api/application.deploy
```

with an application ID and API key.

Sources:

- [Dokploy automatic deployment](https://docs.dokploy.com/docs/core/auto-deploy)
- [Dokploy application API](https://docs.dokploy.com/docs/api/application)
- [Dokploy deployment documentation](https://docs.dokploy.com/docs/core/applications/going-production)

You should not place unrestricted Dokploy credentials in the customer-facing application.

Instead:

```text
CMS API
   │
   ▼
Internal build/deployment worker
   │
   ▼
Dokploy API
```

The deployment credentials should be held only by the internal worker.

You also need:

- Health-check verification
- Deployment timeout handling
- Retry logic
- Rollback support
- Previous deployment tracking
- Deployment logs
- Atomic “current release” state

Dokploy's documentation also recommends considering external CI/CD builds rather than making the production server do all resource-intensive builds. That may become important if multiple customers publish simultaneously.

A robust production arrangement could be:

```text
CMS → Build queue → CI/build worker → Container registry → Dokploy deploy API
```

This prevents customer content publishing from consuming all CPU and memory on your Dokploy host.

---

# Scheduling

Scheduled publishing should happen in the CMS, not inside the website.

For example:

```text
Customer schedules article for:
2026-09-15 09:00 Europe/Brussels
```

Your scheduler then:

1. Finds due scheduled entries
2. Creates a publication snapshot
3. Adds a build job
4. Builds and deploys the site
5. Marks the entry published after successful publication

Store the timezone explicitly. Do not store only a local date and assume the server timezone.

```text
scheduledAt:
2026-09-15T09:00:00+02:00
timezone:
Europe/Brussels
```

You should decide what happens if deployment fails:

```text
Scheduled publication triggered
        ↓
Build fails
        ↓
Content remains unpublished
        ↓
Agency receives alert
        ↓
Retry or repair
```

Do not mark content as live merely because the scheduled time has passed. It should become publicly live only after a successful deployment.

---

# Content validation

This is one of the major benefits of your architecture.

Before deploying, validate:

- Required fields
- Slug uniqueness
- Slug format
- Date consistency
- Broken references
- Missing media
- Invalid URLs
- Unsupported rich-text blocks
- Duplicate entries
- Invalid SEO values
- Invalid publication dates
- Broken internal links
- Missing translations
- Route collisions

For example:

```text
Article "Our new office":
- title: valid
- slug: valid
- body: valid
- hero image: valid
- author reference: missing
- result: build rejected
```

You can also run site-specific checks:

```text
Vacancy:
- closing date must be after opening date
- salary range must be valid
- location required
```

This is a much better safety model than blindly converting customer input into React code.

---

# You should not generate React components from customer content

The customer should provide data, not code.

Your agency owns:

```text
ArticleCard
ArticlePage
ArticleListing
VacancyCard
VacancyPage
EventCard
EventPage
```

The customer owns:

```text
title
body
image
date
category
author
location
```

A content entry should select from approved components or blocks, but should never be allowed to inject arbitrary React or JavaScript.

For example:

```text
Article body blocks:
- Rich text
- Image
- Quote
- Callout
- Related articles
```

This allows customers to customize content while preserving:

- Performance
- Security
- Accessibility
- Design consistency
- Type safety
- Build reliability

---

# Should you make it extensible?

Yes, but keep the extension points narrow.

Do not begin by building a general-purpose plugin ecosystem. Build the internal platform around explicit adapters.

## Recommended adapter boundaries

### Content storage adapter

```text
Database
Git
Filesystem
External CMS
```

### Build adapter

```text
TanStack Start
Astro
Next.js
SvelteKit
Custom Node build
```

### Deployment adapter

```text
Dokploy
Docker Compose
Vercel
Netlify
Cloudflare
Kubernetes
SSH/VPS
```

### Asset storage adapter

```text
S3
MinIO
Cloudflare R2
Local filesystem
```

### Authentication adapter

```text
Email/password
OAuth
OIDC
Existing company identity provider
```

Your core domain model should not know that Dokploy or TanStack Start exists.

For example:

```text
Core CMS
├── Organizations
├── Sites
├── Users
├── Schemas
├── Entries
├── Revisions
├── Publications
├── Assets
└── Build jobs

Adapters
├── TanStack Start
├── Dokploy
├── S3
└── Email
```

A conceptual interface might look like:

```text
BuildAdapter
├── validate(snapshot, site)
├── prepare(snapshot, site)
├── build(site, snapshot)
└── getArtifact()

DeploymentAdapter
├── deploy(artifact, target)
├── getStatus(deployment)
├── healthCheck(deployment)
└── rollback(deployment)
```

You do not need to expose these as public plugin APIs immediately. Internal interfaces are enough at first.

---

# Do not couple the public CMS to Dokploy

Dokploy is an implementation detail of your hosting infrastructure.

Your system should think:

```text
Deploy this site release
```

not:

```text
Call Dokploy endpoint X
```

Then the Dokploy adapter handles:

```text
Deploy this site release
→ build/push image
→ call Dokploy
→ poll status
→ verify health
→ return result
```

This makes it possible to support other hosting platforms later without redesigning the CMS.

The same applies to TanStack Start. The core should work with a generic build contract, while your first official adapter can be TanStack Start.

---

# Suggested MVP

I would build the first version with the following scope.

## CMS

- Organizations
- Sites
- Users and invitations
- Basic roles
- Agency-managed collections
- Text fields
- Textarea fields
- Rich text
- Images
- Dates
- Selects
- References
- Slugs
- Draft/published states
- Scheduled publishing
- Revision history
- Basic media library
- Audit log

## Site integration

- TanStack Start adapter
- Build-time content loader
- Generated content manifest
- Static route generation
- Collection-to-route mapping
- Site-specific schema registration

## Publishing

- Content snapshot creation
- Build queue
- Priority levels
- Build logs
- Validation
- Build failure reporting
- Dokploy deployment adapter
- Health checks
- Rollback to previous release

## Preview

- Signed draft preview
- Preview route in the website
- Preview token expiration
- Optional preview deployment later

Do not initially build:

- A visual page builder
- Arbitrary customer-defined components
- GraphQL
- Real-time collaborative editing
- Multi-framework support
- Public plugins
- AI features
- Complex branching workflows
- Marketplace functionality

---

# A possible customer workflow

## Initial project setup

1. You create the customer organization.
2. You register the customer's site.
3. You enable the `article` collection.
4. Your TanStack Start site registers the article schema and route.
5. The customer receives an invitation.
6. The customer sees only the content types enabled for their site.

## Creating an article

1. Customer clicks **Articles**.
2. Customer creates a draft.
3. They fill in the title, body, image, SEO metadata, and publication date.
4. They click **Preview**.
5. The site renders the draft through a protected preview route.
6. Customer clicks **Publish**.

## Publishing

```text
Publish request
      ↓
Create immutable content snapshot
      ↓
Queue build
      ↓
Generate content files
      ↓
Validate
      ↓
Run tests
      ↓
Build TanStack Start app
      ↓
Deploy through Dokploy
      ↓
Run health check
      ↓
Mark release live
```

The customer sees:

```text
Published successfully
Live at https://customer-site.com/blog/example
```

If the build fails:

```text
Your changes could not be published.
The agency has been notified.
```

The previous version remains live.

That last property is essential.

---

# Potential problems with rebuilding the entire application

Your approach is excellent for:

- Marketing websites
- Blogs
- Vacancies
- Events
- Case studies
- News
- Documentation
- Mostly public content

It becomes less suitable for:

- Inventory that changes constantly
- Personalized content
- User-specific dashboards
- Real-time pricing
- Large catalogs updated every few seconds
- Content that must change immediately without a deployment
- High-frequency operational data

For those cases, use a hybrid model:

```text
Mostly static content → build into the site
Frequently changing data → runtime server/database/API
```

You can decide this per collection:

```text
Article:
- build-time

Vacancy:
- build-time

Job application submissions:
- runtime

Product stock:
- runtime

Customer account data:
- runtime
```

This is another reason to model content collections explicitly rather than treating every piece of data identically.

---

# A significant operational concern

If every customer publish triggers a full TanStack Start build, you may eventually have:

- Queue congestion
- Duplicate builds
- High CPU and memory consumption
- Long publication times
- Multiple deployments racing with one another
- A customer waiting behind another customer's build

You should plan for:

- Per-site build locking
- Global worker concurrency
- Job deduplication
- Cancellation of obsolete queued releases
- Build timeouts
- Retry policies
- Priority queues
- Separate build workers
- Build caching
- Incremental builds where possible

At minimum:

```text
Only one deployment per site at a time.
```

If three publications are queued for the same site, only the latest not-yet-started release may be needed.

TanStack Start's prerendering configuration includes concurrency and retry controls, which are useful at the site build level, but you will still need orchestration outside the framework.

---

The open-source project should not be marketed merely as “another headless CMS.” Its sharper positioning would be something like:

> A build-time CMS for agencies and performance-focused websites.

or:

> A schema-driven CMS that publishes content into your application instead of making your visitors fetch it.

---

# My overall recommendation

Yes, build this—but initially build it as an **internal publishing platform**, not as a general-purpose CMS.

The most valuable parts are:

1. Agency-controlled schemas
2. Simple customer editing
3. Draft preview
4. Immutable content snapshots
5. Build-time content generation
6. Safe validation
7. Queued deployments
8. Rollbacks
9. TanStack Start integration
10. Dokploy deployment automation

The core architectural rule should be:

> Customers can control content values, but they cannot create presentation behavior that your application does not explicitly support.

And the most important publishing rule should be:

> A content change is not live until the new build has passed validation, deployed successfully, and passed its health check.

That gives you the performance characteristics you want without sacrificing editorial usability. It also gives your agency a repeatable system for future sites instead of manually converting customer documents into React components every time.
