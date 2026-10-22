import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArecaClient, FieldDrop } from './client.js'
import { FieldDropsRequiredError } from './client.js'
import { manifestFromConfig } from './config.js'
import { pushManifest } from './manifest-push.js'
import type { SiteContentConfig } from './types.js'

const confirmMock = vi.hoisted(() => vi.fn())
vi.mock('@clack/prompts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, confirm: confirmMock }
})

const config: SiteContentConfig = {
  siteKey: 'acme',
  collections: {
    articles: {
      route: '/blog/$slug',
      fields: [{ key: 'title', label: 'Title', type: 'text' }],
    },
  },
}

const subtitle: FieldDrop = { kind: 'collection', key: 'articles', field: 'subtitle', entries: 3 }
const phone: FieldDrop = { kind: 'global', key: 'companyInfo', field: 'phone', entries: 1 }

/** A CMS that refuses any push which does not confirm every drop that holds content. */
function cms(drops: FieldDrop[]) {
  const syncManifest = vi.fn(async (_config: SiteContentConfig, options?: { confirmDropFields?: string[] }) => {
    const confirmed = new Set(options?.confirmDropFields ?? [])
    const pending = drops.filter((drop) => !confirmed.has(`${drop.key}.${drop.field}`))
    if (pending.length > 0) throw new FieldDropsRequiredError(pending)
    return { ok: true as const }
  })
  return {
    client: { syncManifest } as unknown as ArecaClient,
    syncManifest,
  }
}

let log: ReturnType<typeof vi.spyOn>

afterEach(() => {
  confirmMock.mockReset()
  log?.mockRestore()
})

function quiet() {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  return log
}

describe('pushManifest', () => {
  it('pushes without prompting when nothing is removed', async () => {
    const { client, syncManifest } = cms([])
    await pushManifest({ config, client, interactive: true })
    expect(syncManifest).toHaveBeenCalledTimes(1)
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('lists the drops and refuses on a non-TTY without a confirmation, pushing nothing', async () => {
    quiet()
    const { client, syncManifest } = cms([subtitle])
    await expect(pushManifest({ config, client, interactive: false })).rejects.toThrow(
      /articles\.subtitle.*--confirm-drop.*--yes/,
    )
    expect(syncManifest).toHaveBeenCalledTimes(1)
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('pushes when every drop is confirmed with --confirm-drop', async () => {
    quiet()
    const { client, syncManifest } = cms([subtitle, phone])
    await pushManifest({
      config,
      client,
      confirmDropFields: ['articles.subtitle', 'companyInfo.phone'],
      interactive: false,
    })
    expect(syncManifest).toHaveBeenCalledTimes(1)
    expect(syncManifest.mock.calls[0]?.[1]).toEqual({
      confirmDropFields: ['articles.subtitle', 'companyInfo.phone'],
    })
  })

  it('names the drop still unconfirmed when only some are confirmed', async () => {
    quiet()
    const { client } = cms([subtitle, phone])
    await expect(
      pushManifest({ config, client, confirmDropFields: ['articles.subtitle'], interactive: false }),
    ).rejects.toThrow(/companyInfo\.phone/)
  })

  it('accepts every listed drop with --yes, and shows what is lost', async () => {
    const log = quiet()
    const { client, syncManifest } = cms([subtitle, phone])
    await pushManifest({ config, client, yes: true, interactive: false })
    expect(syncManifest.mock.calls.at(-1)?.[1]).toEqual({
      confirmDropFields: ['articles.subtitle', 'companyInfo.phone'],
    })
    const printed = log.mock.calls.flat().map(String).join('\n')
    expect(printed).toContain('articles.subtitle: 3 entries lose this field')
    expect(printed).toContain('companyInfo.phone: 1 entry loses this field')
  })

  it('asks on a TTY with the default answer No, and pushes after a yes', async () => {
    quiet()
    confirmMock.mockResolvedValueOnce(true)
    const { client, syncManifest } = cms([subtitle])
    await pushManifest({ config, client, interactive: true })
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(confirmMock.mock.calls[0]?.[0]).toMatchObject({ initialValue: false })
    expect(syncManifest.mock.calls.at(-1)?.[1]).toEqual({ confirmDropFields: ['articles.subtitle'] })
  })

  it('aborts on a TTY when the prompt is declined, pushing nothing more', async () => {
    quiet()
    confirmMock.mockResolvedValueOnce(false)
    const { client, syncManifest } = cms([subtitle])
    await expect(pushManifest({ config, client, interactive: true })).rejects.toThrow(
      /not confirmed. Nothing was pushed/,
    )
    expect(syncManifest).toHaveBeenCalledTimes(1)
  })

  it('leaves other errors to the caller unchanged', async () => {
    const failure = new Error('Failed to sync manifest (500)')
    const client = { syncManifest: vi.fn().mockRejectedValue(failure) } as unknown as ArecaClient
    await expect(pushManifest({ config, client, interactive: true })).rejects.toBe(failure)
    expect(confirmMock).not.toHaveBeenCalled()
  })
})
