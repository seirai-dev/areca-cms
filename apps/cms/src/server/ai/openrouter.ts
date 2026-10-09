const OPENROUTER_API = 'https://openrouter.ai/api/v1'
const MODELS_TTL_MS = 10 * 60 * 1000

type FetchFn = typeof fetch

export type AiModelOption = {
  id: string
  name: string
  contextLength: number | null
  /** USD per million tokens. */
  promptPrice: number | null
  completionPrice: number | null
  supportsImages: boolean
}

type RawModel = {
  id?: unknown
  name?: unknown
  context_length?: unknown
  pricing?: { prompt?: unknown; completion?: unknown }
  architecture?: { input_modalities?: unknown }
  supported_parameters?: unknown
}

const perMillion = (value: unknown) => {
  const parsed = typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : null
}

/** Only models that can be held to a strict JSON schema are usable. */
export function toModelOptions(raw: unknown): AiModelOption[] {
  const list = (raw as { data?: unknown } | null)?.data
  if (!Array.isArray(list)) return []
  const out: AiModelOption[] = []
  for (const item of list as RawModel[]) {
    if (typeof item.id !== 'string') continue
    const params = Array.isArray(item.supported_parameters)
      ? (item.supported_parameters as unknown[])
      : []
    if (!params.includes('structured_outputs')) continue
    const modalities = Array.isArray(item.architecture?.input_modalities)
      ? (item.architecture.input_modalities as unknown[])
      : []
    out.push({
      id: item.id,
      name: typeof item.name === 'string' ? item.name : item.id,
      contextLength:
        typeof item.context_length === 'number' ? item.context_length : null,
      promptPrice: perMillion(item.pricing?.prompt),
      completionPrice: perMillion(item.pricing?.completion),
      supportsImages: modalities.includes('image'),
    })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

let cache: { at: number; models: AiModelOption[] } | null = null

/** OpenRouter's public catalogue (no key needed), cached for 10 minutes. */
export async function listOpenRouterModels(
  fetchFn: FetchFn = fetch,
): Promise<AiModelOption[]> {
  if (cache && Date.now() - cache.at < MODELS_TTL_MS) return cache.models
  const response = await fetchFn(`${OPENROUTER_API}/models`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`OpenRouter model list failed (${response.status})`)
  }
  const models = toModelOptions(await response.json())
  cache = { at: Date.now(), models }
  return models
}

export async function findOpenRouterModel(id: string, fetchFn?: FetchFn) {
  try {
    const models = await listOpenRouterModels(fetchFn)
    return models.find((model) => model.id === id) ?? null
  } catch {
    return null
  }
}

/** True when OpenRouter accepts the key. */
export async function verifyOpenRouterKey(
  apiKey: string,
  fetchFn: FetchFn = fetch,
): Promise<boolean> {
  const response = await fetchFn(`${OPENROUTER_API}/key`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 401 || response.status === 403) return false
  if (!response.ok) {
    throw new Error(`OpenRouter key check failed (${response.status})`)
  }
  return true
}
