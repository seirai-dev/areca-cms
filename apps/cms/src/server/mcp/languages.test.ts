import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '#/db'
import { asset, collection, entry, membership, site, user } from '#/db/schema'
import type { EntryData, SiteLanguages } from '#/lib/types'
import {
  cleanupTestSite,
  createTestCollection,
  createTestGlobal,
  createTestSite,
} from '#/server/content/test-utils'

import { createMcpKey } from './keys'
import { handleMcpRequest } from './http'

vi.hoisted(() => {
  process.env.ADMIN_MFA_REQUIRED = 'true'
})

const hasDb = Boolean(process.env.DATABASE_URL)
const MCP_URL = 'https://cms.test/api/mcp'
const languages: SiteLanguages = { main: 'nl', all: ['nl', 'en', 'fr'] }

const fields = [
  { key: 'title', label: 'Title', type: 'text' as const, required: true },
  { key: 'slug', label: 'Slug', type: 'slug' as const, required: true },
  { key: 'body', label: 'Body', type: 'richtext' as const, required: true },
  { key: 'salary', label: 'Salary', type: 'number' as const },
]

type Outcome = {
  isError: boolean
  text: string
  data: Record<string, unknown> | null
}

async function connect(token: string) {
  const client = new Client({ name: 'areca-lang-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: (input, init) => handleMcpRequest(new Request(input, init)),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  await client.connect(transport)
  return client
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Outcome> {
  const result = await client.callTool({ name, arguments: args })
  const first = result.content.at(0)
  const text = first?.type === 'text' ? first.text : ''
  let data: Record<string, unknown> | null = null
  if (!result.isError) {
    try {
      const parsed: unknown = JSON.parse(text)
      data =
        parsed && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>)
          : null
    } catch {
      data = null
    }
  }
  return { isError: Boolean(result.isError), text, data }
}

async function toolNames(client: Client): Promise<string[]> {
  const { tools } = await client.listTools()
  return tools.map((tool) => tool.name).sort()
}

async function storedDraft(id: string): Promise<EntryData> {
  const [row] = await db.select().from(entry).where(eq(entry.id, id)).limit(1)
  return row.draftData
}

async function makeWorld(siteLanguages: SiteLanguages | null) {
  const ctx = await createTestSite({ languages: siteLanguages })
  await createTestCollection(ctx.site.id, {
    key: 'vacancies',
    routePattern: '/vacatures/$slug',
    fields,
    requiredLanguages: siteLanguages ? ['en'] : [],
  })
  await db
    .insert(membership)
    .values({ userId: ctx.actor.id, organizationId: ctx.org.id, role: 'owner' })
  const agencyId = crypto.randomUUID()
  await db.insert(user).values({
    id: agencyId,
    name: 'agency',
    email: `agency-${agencyId}@test.local`,
    emailVerified: true,
    isAgencyAdmin: true,
    twoFactorEnabled: true,
  })
  const editorId = crypto.randomUUID()
  await db.insert(user).values({
    id: editorId,
    name: 'editor',
    email: `editor-${editorId}@test.local`,
    emailVerified: true,
  })
  await db
    .insert(membership)
    .values({ userId: editorId, organizationId: ctx.org.id, role: 'editor' })
  const keyFor = async (
    userId: string,
    role: 'owner' | 'editor' | 'agency',
  ) => {
    const created = await createMcpKey({
      userId,
      siteId: ctx.site.id,
      organizationId: ctx.org.id,
      name: `${role} key`,
      expiresInDays: 90,
      allowGoLive: false,
      role,
    })
    return created.token
  }
  return {
    ctx,
    owner: await keyFor(ctx.actor.id, 'owner'),
    editor: await keyFor(editorId, 'editor'),
    agency: await keyFor(agencyId, 'agency'),
    cleanup: async () => {
      await db.delete(site).where(eq(site.id, ctx.site.id))
      await cleanupTestSite(ctx)
      await db.delete(user).where(inArray(user.id, [agencyId, editorId]))
    },
  }
}

async function createVacancy(client: Client, title: string, slug: string) {
  const created = await call(client, 'create_entry', {
    collection: 'vacancies',
    fields: { title, slug, body: '## Over de baan\n\nTekst.', salary: 4000 },
  })
  expect(created.isError).toBe(false)
  return created.data as Record<string, unknown>
}

describe.skipIf(!hasDb)('MCP with content languages', () => {
  describe('on a site with languages', () => {
    let world: Awaited<ReturnType<typeof makeWorld>>
    let owner: Client

    beforeAll(async () => {
      world = await makeWorld(languages)
      owner = await connect(world.owner)
    })
    afterAll(async () => {
      await world.cleanup()
    })

    it('reports the languages, names and per-collection language facts in get_site_info', async () => {
      const info = await call(owner, 'get_site_info')
      expect(info.data?.languages).toEqual({
        main: 'nl',
        all: ['nl', 'en', 'fr'],
        names: { nl: 'Dutch', en: 'English', fr: 'French' },
      })
      const vacancies = (
        info.data?.collections as Record<string, unknown>[]
      ).find((c) => c.key === 'vacancies')
      expect(vacancies).toMatchObject({
        requiredLanguages: ['en'],
        translatableFields: ['title', 'body'],
      })
      expect(info.data?.guide).toContain('Languages:')
    })

    it('describes translatable fields and an update_entry example with a locale', async () => {
      const schema = await call(owner, 'get_collection_schema', {
        collection: 'vacancies',
      })
      const byKey = Object.fromEntries(
        (schema.data?.fields as { key: string; translatable?: boolean }[]).map(
          (field) => [field.key, field.translatable],
        ),
      )
      expect(byKey).toEqual({
        title: true,
        slug: false,
        body: true,
        salary: false,
      })
      expect(schema.data?.translation).toMatchObject({
        example: {
          tool: 'update_entry',
          arguments: { locale: 'en' },
        },
      })
    })

    it('writes a translation without changing the main language, and lists shared fields it changed', async () => {
      const created = await createVacancy(
        owner,
        'Backend ontwikkelaar',
        'backend-ontwikkelaar',
      )
      const id = created.id as string
      const updated = await call(owner, 'update_entry', {
        id,
        locale: 'en',
        fields: { title: 'Backend developer', salary: 4500 },
        seo: { title: 'Backend developer job' },
        slug: 'backend-developer',
      })
      expect(updated.isError).toBe(false)
      expect(updated.data).toMatchObject({
        locale: 'en',
        slug: 'backend-developer',
        fields: { title: 'Backend developer', salary: 4500 },
        sharedFieldsUpdated: ['salary'],
      })
      const draft = await storedDraft(id)
      expect(draft.title).toBe('Backend ontwikkelaar')
      expect(draft.slug).toBe('backend-ontwikkelaar')
      expect(draft.salary).toBe(4500)
      expect(draft.$i18n).toEqual({
        en: {
          title: 'Backend developer',
          $slug: 'backend-developer',
          $seo: { title: 'Backend developer job' },
        },
      })
    })

    it('merges a partial translation update instead of clearing the rest of the language', async () => {
      const created = await createVacancy(owner, 'Tuinier', 'tuinier')
      const id = created.id as string
      await call(owner, 'update_entry', {
        id,
        locale: 'en',
        fields: { title: 'Gardener', body: '## Work\n\nGardening.' },
      })
      const second = await call(owner, 'update_entry', {
        id,
        locale: 'en',
        fields: { title: 'Head gardener' },
      })
      expect(second.isError).toBe(false)
      const draft = await storedDraft(id)
      const en = (draft.$i18n as Record<string, EntryData>).en
      expect(en.title).toBe('Head gardener')
      expect(en.body).toBeDefined()
    })

    it('shows the main language by default, with translations for the other languages', async () => {
      const created = await createVacancy(
        owner,
        'Verpleegkundige',
        'verpleegkundige',
      )
      const id = created.id as string
      await call(owner, 'update_entry', {
        id,
        locale: 'en',
        fields: { title: 'Nurse' },
      })
      const main = await call(owner, 'get_entry', { id })
      expect(main.data).toMatchObject({
        locale: 'nl',
        fields: { title: 'Verpleegkundige' },
        translations: {
          en: { complete: false, missing: ['body'] },
          fr: { complete: false, missing: ['title', 'body'] },
        },
      })
    })

    it('reads one language with get_entry, formatting its rich text as Markdown', async () => {
      const created = await createVacancy(owner, 'Chauffeur', 'chauffeur')
      const id = created.id as string
      await call(owner, 'update_entry', {
        id,
        locale: 'en',
        fields: { title: 'Driver', body: '## English body\n\nHello.' },
        slug: 'driver',
      })
      const en = await call(owner, 'get_entry', { id, locale: 'en' })
      expect(en.isError).toBe(false)
      expect(en.data).toMatchObject({
        locale: 'en',
        slug: 'driver',
        fields: {
          title: 'Driver',
          body: '## English body\n\nHello.',
          salary: 4000,
        },
      })
      expect(en.data).not.toHaveProperty('translations')
      const fr = await call(owner, 'get_entry', { id, locale: 'fr' })
      expect((fr.data?.fields as Record<string, unknown>).title).toBeUndefined()
      expect(fr.data?.fields).toMatchObject({ salary: 4000 })
    })

    it('refuses a language the site does not have', async () => {
      const created = await createVacancy(owner, 'Kok', 'kok')
      const result = await call(owner, 'get_entry', {
        id: created.id,
        locale: 'de',
      })
      expect(result.isError).toBe(true)
      expect(result.text).toContain('"de" is not one of this site')
    })

    it('creates an entry in a non-main language, leaving the main language empty', async () => {
      const created = await call(owner, 'create_entry', {
        collection: 'vacancies',
        locale: 'en',
        fields: {
          title: 'Developer',
          slug: 'developer',
          body: '## Hi\n\nBody.',
        },
      })
      expect(created.isError).toBe(false)
      expect(created.data).toMatchObject({ locale: 'en' })
      const draft = await storedDraft(created.data?.id as string)
      expect(draft.title).toBeUndefined()
      expect((draft.$i18n as Record<string, EntryData>).en.title).toBe(
        'Developer',
      )
    })

    it('blocks mark_ready with the languages and fields that are missing, naming how to fill them', async () => {
      const created = await createVacancy(owner, 'Schilder', 'schilder')
      const id = created.id as string
      // Main is complete, English is not: body is missing in en.
      await call(owner, 'update_entry', {
        id,
        locale: 'en',
        fields: { title: 'Painter' },
      })
      const ready = await call(owner, 'mark_ready', { id })
      expect(ready.isError).toBe(true)
      expect(ready.text).toContain('English is missing: Body')
      expect(ready.text).toContain('locale "en"')
    })

    it('filters list_entries by a missing language', async () => {
      const complete = await createVacancy(
        owner,
        'Stratenmaker',
        'stratenmaker',
      )
      await call(owner, 'update_entry', {
        id: complete.id,
        locale: 'en',
        fields: { title: 'Paver', body: '## Paving\n\nText.' },
      })
      const missing = await call(owner, 'list_entries', {
        collection: 'vacancies',
        missingLanguage: 'en',
      })
      const ids = (missing.data?.items as { id: string }[]).map(
        (item) => item.id,
      )
      expect(ids).not.toContain(complete.id)
      expect(ids.length).toBeGreaterThan(0)
    })

    it('lists every entry when list_entries has no missingLanguage', async () => {
      // Complete in the main language, so a main-language "missing" filter
      // would hide it. Without missingLanguage nothing may be filtered out.
      const complete = await createVacancy(owner, 'Opperman', 'opperman')
      const listed = await call(owner, 'list_entries', {
        collection: 'vacancies',
        limit: 100,
      })
      expect(listed.isError).toBe(false)
      const ids = (listed.data?.items as { id: string }[]).map(
        (item) => item.id,
      )
      expect(ids).toContain(complete.id)

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(entry)
        .innerJoin(collection, eq(entry.collectionId, collection.id))
        .where(
          and(
            eq(entry.siteId, world.ctx.site.id),
            eq(collection.key, 'vacancies'),
          ),
        )
      expect(listed.data?.total).toBe(count)

      const searched = await call(owner, 'list_entries', {
        collection: 'vacancies',
        search: 'opperman',
      })
      expect(
        (searched.data?.items as { id: string }[]).map((item) => item.id),
      ).toContain(complete.id)
    })

    it('rejects a locale for list_entries that the site does not have', async () => {
      const result = await call(owner, 'list_entries', {
        collection: 'vacancies',
        missingLanguage: 'de',
      })
      expect(result.isError).toBe(true)
      expect(result.text).toContain('"de" is not one of this site')
    })

    it('returns a preview URL in the requested language', async () => {
      const created = await createVacancy(owner, 'Bakker', 'bakker')
      const preview = await call(owner, 'get_preview_url', {
        id: created.id,
        locale: 'en',
      })
      expect(preview.isError).toBe(false)
      expect(preview.data?.url).toContain('locale=en')
    })

    it('reads and writes a section in one language', async () => {
      await createTestGlobal(world.ctx.site.id, {
        key: 'companyInfo',
        fields: [{ key: 'email', label: 'Email', type: 'text' }],
      })
      const current = await call(owner, 'get_global', {
        global: 'companyInfo',
        locale: 'en',
      })
      expect(current.isError).toBe(false)
      expect(current.data).toMatchObject({ locale: 'en' })
      const updated = await call(owner, 'update_global', {
        global: 'companyInfo',
        locale: 'en',
        fields: { email: 'info@example.com' },
      })
      expect(updated.isError).toBe(false)
      expect(updated.data).toMatchObject({
        locale: 'en',
        sharedFieldsUpdated: [],
      })
      const [section] = await db
        .select()
        .from(entry)
        .innerJoin(collection, eq(entry.collectionId, collection.id))
        .where(
          and(
            eq(collection.siteId, world.ctx.site.id),
            eq(collection.key, 'companyInfo'),
          ),
        )
      expect(section.entry.draftData).toMatchObject({
        $i18n: { en: { email: 'info@example.com' } },
      })
    })

    it('creates a non-main entry when the schema has no required text field, and merges its slug', async () => {
      await createTestCollection(world.ctx.site.id, {
        key: 'notes',
        routePattern: '/notes/$slug',
        fields: [
          { key: 'title', label: 'Title', type: 'text' },
          { key: 'slug', label: 'Slug', type: 'slug', required: true },
          { key: 'body', label: 'Body', type: 'richtext' },
        ],
      })
      const created = await call(owner, 'create_entry', {
        collection: 'notes',
        locale: 'fr',
        fields: { title: 'Note', slug: 'note' },
      })
      expect(created.isError).toBe(false)
      expect(created.data).toMatchObject({ locale: 'fr', slug: 'note' })
      const draft = await storedDraft(created.data?.id as string)
      expect(draft.title).toBeUndefined()
      expect(draft.$i18n).toEqual({
        fr: { title: 'Note', $slug: 'note' },
      })
    })

    it('updates an asset alt text per language', async () => {
      const [row] = await db
        .insert(asset)
        .values({
          organizationId: world.ctx.org.id,
          storageKey: `${world.ctx.org.id}/alt-${crypto.randomUUID()}.png`,
          originalFilename: 'alt.png',
          mimeType: 'image/png',
          size: 10,
          altText: 'Dutch alt',
          originSiteId: world.ctx.site.id,
        })
        .returning()
      const result = await call(owner, 'update_asset_alt', {
        id: row.id,
        altText: 'English alt',
        locale: 'en',
      })
      expect(result.isError).toBe(false)
      expect(result.data).toMatchObject({
        locale: 'en',
        localeAlt: 'English alt',
        alt: 'Dutch alt',
      })
    })

    it('lists set_site_languages only for agency admins, and refuses it for owners', async () => {
      expect(await toolNames(owner)).not.toContain('set_site_languages')
      const agency = await connect(world.agency)
      expect(await toolNames(agency)).toContain('set_site_languages')
      // Not advertised to owners, so the call is refused as an unknown tool.
      await expect(
        call(owner, 'set_site_languages', { main: 'nl', all: ['nl'] }),
      ).rejects.toThrow()
    })

    it('sets languages as an agency admin, and reports the gaps a main-language change leaves', async () => {
      const agency = await connect(world.agency)
      const created = await createVacancy(owner, 'Metselaar', 'metselaar')
      expect(created.id).toBeTruthy()
      const result = await call(agency, 'set_site_languages', {
        main: 'en',
        all: ['en', 'nl', 'fr'],
      })
      expect(result.isError).toBe(false)
      expect(result.data).toMatchObject({
        languages: { main: 'en', all: ['en', 'nl', 'fr'] },
      })
      expect(typeof result.data?.gaps).toBe('number')
      expect(result.data?.gaps as number).toBeGreaterThan(0)
      // Restore the original languages for the tests that follow.
      await call(agency, 'set_site_languages', {
        main: 'nl',
        all: ['nl', 'en', 'fr'],
      })
    })

    it('stores translatable flags, required languages and routes from upsert_collection', async () => {
      const agency = await connect(world.agency)
      const result = await call(agency, 'upsert_collection', {
        key: 'pages',
        label: 'Pages',
        routePattern: '/$slug',
        fields: [
          { key: 'title', label: 'Title', type: 'text', required: true },
          { key: 'slug', label: 'Slug', type: 'slug', required: true },
          { key: 'hero', label: 'Hero', type: 'text', translatable: false },
        ],
        requiredLanguages: ['en'],
        routes: { nl: '/pagina/$slug' },
      })
      expect(result.isError).toBe(false)
      expect(result.data).toMatchObject({
        requiredLanguages: ['en'],
        routes: { nl: '/pagina/$slug' },
      })
      const [row] = await db
        .select()
        .from(collection)
        .where(
          and(
            eq(collection.siteId, world.ctx.site.id),
            eq(collection.key, 'pages'),
          ),
        )
      expect(row.localizedRoutes).toEqual({ nl: '/pagina/$slug' })
      expect(row.requiredLanguages).toEqual(['en'])
    })

    it('stores translatable fields and required languages from upsert_global', async () => {
      const agency = await connect(world.agency)
      const result = await call(agency, 'upsert_global', {
        key: 'homePage',
        label: 'Home page',
        fields: [
          {
            key: 'headline',
            label: 'Headline',
            type: 'text',
            translatable: true,
          },
          { key: 'hero', label: 'Hero', type: 'image', translatable: false },
        ],
        requiredLanguages: ['en'],
      })
      expect(result.isError).toBe(false)
      expect(result.data).toMatchObject({ requiredLanguages: ['en'] })
      const [row] = await db
        .select()
        .from(collection)
        .where(
          and(
            eq(collection.siteId, world.ctx.site.id),
            eq(collection.key, 'homePage'),
          ),
        )
      expect(row.requiredLanguages).toEqual(['en'])
      expect(row.fields[0]).toMatchObject({
        key: 'headline',
        translatable: true,
      })
    })

    it('rejects a route pattern without $slug', async () => {
      const agency = await connect(world.agency)
      const result = await call(agency, 'upsert_collection', {
        key: 'pages',
        label: 'Pages',
        routePattern: '/$slug',
        fields: [{ key: 'title', label: 'Title', type: 'text' }],
        routes: { en: '/english' },
      })
      expect(result.isError).toBe(true)
    })

    it('keeps the tool list the same for an owner', async () => {
      const names = await toolNames(owner)
      expect(names).toContain('get_entry')
      expect(names).not.toContain('upsert_collection')
    })
  })

  describe('on a site with one language', () => {
    let world: Awaited<ReturnType<typeof makeWorld>>
    let owner: Client

    beforeAll(async () => {
      world = await makeWorld(null)
      owner = await connect(world.owner)
    })
    afterAll(async () => {
      await world.cleanup()
    })

    it('keeps get_site_info free of language keys', async () => {
      const info = await call(owner, 'get_site_info')
      expect(info.data).not.toHaveProperty('languages')
      const vacancies = (
        info.data?.collections as Record<string, unknown>[]
      ).find((c) => c.key === 'vacancies')
      expect(vacancies).not.toHaveProperty('requiredLanguages')
      expect(vacancies).not.toHaveProperty('translatableFields')
      expect(info.data?.guide).not.toContain('Languages:')
    })

    it('keeps the schema and entry output unchanged', async () => {
      const schema = await call(owner, 'get_collection_schema', {
        collection: 'vacancies',
      })
      expect(schema.data).not.toHaveProperty('translation')
      for (const field of schema.data?.fields as Record<string, unknown>[]) {
        expect(field).not.toHaveProperty('translatable')
      }
      const created = await createVacancy(owner, 'Timmerman', 'timmerman')
      const entryRead = await call(owner, 'get_entry', { id: created.id })
      expect(entryRead.data).not.toHaveProperty('translations')
      expect(entryRead.data).not.toHaveProperty('locale')
      expect(entryRead.data).not.toHaveProperty('sharedFieldsUpdated')
    })

    it('refuses a locale with a clear message', async () => {
      const created = await createVacancy(owner, 'Loodgieter', 'loodgieter')
      const result = await call(owner, 'update_entry', {
        id: created.id,
        locale: 'en',
        fields: { title: 'Plumber' },
      })
      expect(result.isError).toBe(true)
      expect(result.text).toContain('This site has one language')
    })

    it('refuses a locale on get_entry, list_entries and get_preview_url', async () => {
      const created = await createVacancy(owner, 'Dakdekker', 'dakdekker')
      for (const [name, args] of [
        ['get_entry', { id: created.id, locale: 'en' }],
        ['list_entries', { collection: 'vacancies', missingLanguage: 'en' }],
        ['get_preview_url', { id: created.id, locale: 'en' }],
      ] as const) {
        const result = await call(owner, name, { ...args })
        expect(result.isError).toBe(true)
        expect(result.text).toContain('This site has one language')
      }
    })

    it('keeps upsert_global output unchanged on a single-language site', async () => {
      const agency = await connect(world.agency)
      const result = await call(agency, 'upsert_global', {
        key: 'footer',
        label: 'Footer',
        fields: [{ key: 'note', label: 'Note', type: 'text' }],
      })
      expect(result.isError).toBe(false)
      expect(Object.keys(result.data ?? {}).sort()).toEqual([
        'enabled',
        'fieldKeys',
        'key',
        'label',
        'previewPath',
        'seo',
      ])
    })

    it('does not add a locale or translations to a single-language update', async () => {
      const created = await createVacancy(owner, 'Glazenmaker', 'glazenmaker')
      const result = await call(owner, 'update_entry', {
        id: created.id,
        fields: { title: 'Glassmaker' },
      })
      expect(result.isError).toBe(false)
      expect(result.data).not.toHaveProperty('locale')
      expect(result.data).not.toHaveProperty('translations')
      expect(result.data).not.toHaveProperty('sharedFieldsUpdated')
    })

    it('still offers set_site_languages to agency keys on a single-language site', async () => {
      const agency = await connect(world.agency)
      expect(await toolNames(agency)).toContain('set_site_languages')
    })
  })
})
