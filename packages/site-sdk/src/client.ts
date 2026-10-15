import { cmsAssetDownloader } from './assets.js'
import { manifestFromConfig } from './config.js'
import type {
  PreviewResult,
  SiteContentConfig,
  SiteManifest,
  Snapshot,
  SnapshotAsset,
} from './types.js'

export type ArecaClientOptions = {
  cmsUrl?: string
  siteToken?: string
  schemaToken?: string
}

export type ArecaClient = {
  syncManifest: (config: SiteContentConfig) => Promise<{ ok: true }>
  fetchManifest: () => Promise<SiteManifest>
  fetchSnapshot: (options?: { publicationId?: string }) => Promise<Snapshot>
  /** `locale` asks the CMS for the preview resolved in that language. */
  fetchPreview: (token: string, options?: { locale?: string }) => Promise<PreviewResult>
  /** Downloads a media file listed in `Snapshot.assets`. */
  fetchAsset: (asset: SnapshotAsset) => Promise<Uint8Array>
}

export function createArecaClient(
  options: ArecaClientOptions = {},
): ArecaClient {
  const cmsUrl = normalizeBaseUrl(
    requiredValue(
      options.cmsUrl ?? process.env.ARECA_CMS_URL,
      'ARECA_CMS_URL',
      'cmsUrl',
    ),
  )
  const siteToken = requiredValue(
    options.siteToken ?? process.env.ARECA_SITE_TOKEN,
    'ARECA_SITE_TOKEN',
    'siteToken',
  )

  const headers = {
    Authorization: `Bearer ${siteToken}`,
    Accept: 'application/json',
  }

  async function cmsFetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to reach CMS at ${cmsUrl}. ${detail}. If the CMS is up, publish content before running areca pull.`,
      )
    }
  }

  return {
    fetchAsset: cmsAssetDownloader(cmsUrl),

    async syncManifest(config) {
      const res = await cmsFetch(`${cmsUrl}/api/sites/manifest`, {
        method: 'POST',
        headers: {
          ...headers,
          Authorization: `Bearer ${requiredValue(options.schemaToken ?? process.env.ARECA_SCHEMA_TOKEN, 'ARECA_SCHEMA_TOKEN', 'schemaToken')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(manifestFromConfig(config)),
      })

      if (!res.ok) {
        throw new Error(await formatHttpError('Failed to sync manifest', res))
      }

      return (await res.json()) as { ok: true }
    },

    async fetchManifest() {
      const res = await cmsFetch(`${cmsUrl}/api/sites/manifest`, {
        method: 'GET',
        headers,
      })

      if (!res.ok) {
        throw new Error(await formatHttpError('Failed to fetch manifest', res))
      }

      return (await res.json()) as SiteManifest
    },

    async fetchSnapshot(options = {}) {
      const query = options.publicationId
        ? `?${new URLSearchParams({ publicationId: options.publicationId })}`
        : ''
      const res = await cmsFetch(
        `${cmsUrl}/api/sites/snapshot/current${query}`,
        {
          method: 'GET',
          headers,
        },
      )

      if (res.status === 404 && !options.publicationId) {
        const detail = await readError(res)
        throw new Error(
          `No publication exists for this site. Publish content in the CMS before running areca pull.${detail ? ` ${detail}` : ''}`,
        )
      }

      if (!res.ok) {
        throw new Error(await formatHttpError('Failed to fetch snapshot', res))
      }

      const snapshot = (await res.json()) as Snapshot
      if (
        options.publicationId &&
        snapshot.publicationId !== options.publicationId
      ) {
        throw new Error(
          `Expected publication ${options.publicationId}, received ${snapshot.publicationId}`,
        )
      }
      return snapshot
    },

    async fetchPreview(token, options = {}) {
      const params = new URLSearchParams({ token })
      if (options.locale !== undefined) params.set('locale', options.locale)
      const url = `${cmsUrl}/api/sites/preview?${params}`
      const res = await cmsFetch(url, {
        method: 'GET',
        headers,
      })

      if (!res.ok) {
        throw new Error(await formatHttpError('Failed to fetch preview', res))
      }

      return (await res.json()) as PreviewResult
    },
  }
}

function requiredValue(
  value: string | undefined,
  envName: string,
  optionName: string,
): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new Error(
      `Missing ${envName}. Set the ${envName} environment variable or pass ${optionName} to createArecaClient().`,
    )
  }
  return trimmed
}

function normalizeBaseUrl(cmsUrl: string): string {
  return cmsUrl.replace(/\/+$/, '')
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) {
      return body.error
    }
  } catch {
    // ignore non-JSON bodies
  }
  return ''
}

async function formatHttpError(prefix: string, res: Response): Promise<string> {
  const detail = await readError(res)
  return detail
    ? `${prefix} (${res.status}): ${detail}`
    : `${prefix} (${res.status})`
}
