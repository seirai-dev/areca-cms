# Recipes

Starting points for collections and sections. Use them in batch B and in the approval table (step 3). Adapt the fields to the client. Keep the list short.

Field rules that apply to every recipe (see the `areca-sdk` skill for the full list):

- Keys (collections, sections and fields) start with a letter. They use letters, digits, `_` or `-`, and are 64 characters at most.
- Collection and section keys cannot be `resolve`, `href`, `preview`, `globals`, `previewGlobals`, `in`, `languages` or `matchLocale`, in any case. Field keys may use them. Also avoid `manifest`, `constructor`, `prototype` and the Windows device names (`con`, `aux`, `nul`, `com1` and so on).
- Every collection needs a `route` with `$slug`. Even a collection with no page (for example testimonials) needs one.
- Every collection gets a `slug` field. Add it in the config, as the examples do.
- Text, textarea, richtext and url are translatable by default on a multilingual site. Names, prices, contact details and shop or apply links are usually not. Mark them `translatable: false`.
- The SDK has no list field. Use one of these instead: a collection with a number field for order, a reference, or several plain fields.
- `group` works only on sections (globals), not on collection fields.
- A `date` or `datetime` field is content only. It does not schedule an entry.
- When the user declines an extra (for example authors or departments), remove every field that points to it (`posts.author`, `vacancies.department`, `posts.category`, `homePage.featuredPost`). Show each removal in the approval table, for example "removed: author (authors declined)".
- Never invent facts for a field (a founding year, a phone number, an address, a salary). If the interview did not give the value, leave an optional field empty. Use placeholder text only for copy, and say so.

Field lines below use: `key` (type, required, notes). `slug` is always `slug` (type slug, required).

## Collections

### Blog posts

Collection `posts`. Route `/blog/$slug`. Label "Blog posts" (or the client's word, such as "News" or "Journal").

- `slug` (slug, required)
- `title` (text, required)
- `excerpt` (textarea), short summary for lists and SEO
- `body` (richtext, required)
- `coverImage` (image)
- `category` (select: `news`, `guides`, `updates`). Use a reference to categories instead if categories need their own page.
- `tags` (text). Comma-separated, with a description that says so. There is no list type.
- `author` (reference to `authors`)
- `publishedAt` (datetime). Content only, does not schedule.

Suggested extras: categories, authors, a home page section that features the latest post.

### Categories

Collection `categories`. Route `/blog/category/$slug`.

- `slug` (slug, required)
- `name` (text, required)
- `description` (textarea)

### Authors (team members)

Collection `authors`. Route `/team/$slug`. Label "Team".

- `slug` (slug, required)
- `name` (text, required, `translatable: false`)
- `role` (text)
- `bio` (textarea)
- `portrait` (image)

Used by posts (author reference) and projects.

### Vacancies (job openings)

Collection `vacancies`. Route `/vacancies/$slug`. Label "Vacancies".

- `slug` (slug, required)
- `title` (text, required)
- `summary` (textarea, required). Shown on the list page and in SEO.
- `description` (richtext, required). Role, tasks, requirements.
- `department` (reference to `departments`)
- `location` (text). For example "Amsterdam (hybrid)".
- `employmentType` (select: `full-time`, `part-time`, `contract`, `internship`, `freelance`). Shared across languages.
- `hoursPerWeek` (number)
- `salaryRange` (text, `translatable: false`). For example "3,000 to 3,800 EUR per month". Keep it as text, the SDK has no currency type.
- `remote` (boolean). Open to remote work.
- `startDate` (date)
- `closingDate` (date). When it closes, the page can say "closed".
- `applyUrl` (url, `translatable: false`). Link to the applicant tracking system.
- `applyEmail` (text, `translatable: false`)

Suggested extras: departments, and a `/vacancies` list page on the site. Entries already have SEO in the CMS, so there is no SEO flag to set here.

### Departments

Collection `departments`. Route `/departments/$slug`.

- `slug` (slug, required)
- `name` (text, required)
- `summary` (textarea)
- `body` (richtext)
- `contactEmail` (text, `translatable: false`)

### Services

Collection `services`. Route `/services/$slug`.

- `slug` (slug, required)
- `title` (text, required)
- `summary` (textarea)
- `body` (richtext)
- `icon` (image)
- `order` (number). Lower numbers show first. Use `orderBy` in the code.

### Projects and case studies

Collection `projects`. Route `/work/$slug`. Label "Projects" or "Work".

- `slug` (slug, required)
- `title` (text, required)
- `client` (text). The client name in the project. Use `translatable: false` if it is a name.
- `summary` (textarea)
- `coverImage` (image)
- `body` (richtext)
- `completedOn` (date)
- `services` (reference to `services`)

### Testimonials

Collection `testimonials`. Route `/testimonials/$slug`. Even when the site shows them on one page, the route is still required.

- `slug` (slug, required)
- `quote` (textarea, required)
- `name` (text, required, `translatable: false`)
- `role` (text)
- `company` (text, `translatable: false`)
- `photo` (image)
- `order` (number)

### FAQ

Collection `faqs`. Route `/faq/$slug`.

- `slug` (slug, required)
- `question` (text, required)
- `answer` (richtext, required)
- `order` (number)

### Events

Collection `events`. Route `/events/$slug`.

- `slug` (slug, required)
- `title` (text, required)
- `summary` (textarea)
- `body` (richtext)
- `coverImage` (image)
- `startsAt` (datetime, required)
- `endsAt` (datetime, `after: "startsAt"`)
- `location` (text)
- `registrationUrl` (url, `translatable: false`)

### Navigation links (optional)

Collection `navigationLinks`. Route `/navigation/$slug`. The site never renders this as a page. It only reads the links.

- `slug` (slug, required)
- `label` (text, required)
- `url` (url, `translatable: false`)
- `order` (number)

Mention the trade-off to the user. A menu that rarely changes is simpler in code. Use this collection when editors must change the menu themselves.

## Sections (site content)

Sections are single sets of values. They have no slug and no route. Set `seo: true` only on pages that have their own SEO (home, about). Set `previewPath` to the page that shows the section, so editors can preview drafts there.

### Company info

Section `companyInfo`. Label "Company info". No SEO.

Ask the user for the company details in batch B: name, email, phone and address. Use only what they give. Leave the others empty. Do not guess a founding year, a phone number or an address.

- `name` (text, required, `translatable: false`)
- `tagline` (textarea). The site's default description in the root head.
- `email` (text, `translatable: false`, `group: "Contact"`)
- `phone` (text, `translatable: false`, `group: "Contact"`)
- `address` (textarea, `group: "Contact"`)
- `mapUrl` (url, `translatable: false`, `group: "Contact"`)
- `instagramUrl` (url, `translatable: false`, `group: "Social"`)
- `linkedinUrl` (url, `translatable: false`, `group: "Social"`)
- `foundedYear` (number)

### Home page

Section `homePage`. Label "Home page". `seo: true`. `previewPath: "/"`.

- `heroEyebrow` (text)
- `heroTitle` (text, required)
- `heroIntro` (textarea, required)
- `heroImage` (image)
- `ctaLabel` (text)
- `ctaUrl` (url, `translatable: false`)
- `featuredPost` (reference to `posts`), when the plan has posts

### About page

Section `aboutPage`. Label "About page". `seo: true`. `previewPath: "/about"`.

- `heading` (text, required)
- `body` (richtext, required)
- `image` (image)

### Footer

Section `footer`. Label "Footer". No SEO. Keep it small.

- `footerNote` (textarea). Short line under the links.
- `copyrightName` (text). Shown after the year.
- `legalNotice` (richtext). Terms or imprint text.

Use `companyInfo` for the address and contact fields. Do not repeat them.

## SEO defaults

- Every entry has SEO in the CMS. Editors fill it in, and the SDK gives `entry.seo`. Use `seoHead` or `seoHeadHtml` in every entry page.
- Sections get SEO only with `seo: true`. Use it for home and about. Read the value from `content.globals.<key>.$seo`.
- The site name and the default description come from `companyInfo`. Use them in the root layout.
- Do not add SEO fields as collection fields. Use the CMS SEO panel.

## Routes and languages

A collection has one `route` in the main language, for example `/blog/$slug`. A language that uses other words gets its own pattern in `routes`, for example `routes: { nl: '/vacatures/$slug' }`. Read from the SDK source (`packages/site-sdk/src/content.ts`):

- The SDK uses `route` and each `routes[locale]` value exactly as written. It never adds a language prefix. Write `/vacatures/$slug`, not `/nl/vacatures/$slug`. A prefix in `routes` is doubled once the site adds `/nl`.
- `content.posts.href(slug)` returns the route of the language in use, with `$slug` replaced. Example: `content.posts.href('my-post')` gives `/blog/my-post`. `content.in('nl').vacancies.href('dev')` gives `/vacatures/dev`. A string slug uses the language from `in(locale)` if set, else the locale function (Paraglide's `getLocale` when it is wired), else the main language. `href(entry)` uses the entry's own language.
- `entry.alternates` maps each complete language tag to its route, again with no prefix: `{ en: '/vacancies/dev', nl: '/vacatures/dev' }`.
- The site adds the prefix. The main language has none. Every other language is `/<tag>` followed by the route, so the Dutch vacancy is `/nl/vacatures/dev`. With Paraglide, the router rewrite does this (see [frameworks.md](frameworks.md)). Without Paraglide, add the prefix in code.

**The rule:** `href()` and `alternates` never include the language prefix. Add `/<tag>` yourself for every language except the main one.

## Route suggestions

| Collection | Route | Page type |
| --- | --- | --- |
| posts | `/blog/$slug` | list at `/blog`, detail |
| categories | `/blog/category/$slug` | list of posts, filtered |
| authors | `/team/$slug` | list at `/team`, detail |
| vacancies | `/vacancies/$slug` | list at `/vacancies`, detail |
| departments | `/departments/$slug` | detail, linked from vacancies |
| services | `/services/$slug` | list at `/services`, detail |
| projects | `/work/$slug` | list at `/work`, detail |
| testimonials | `/testimonials/$slug` | route kept, shown on home |
| faqs | `/faq/$slug` | list at `/faq` |
| events | `/events/$slug` | list at `/events`, detail |
| navigationLinks | `/navigation/$slug` | none (read only) |

Sections have no route. Their pages are `/` (home), `/about`, and the footer appears on every page.
