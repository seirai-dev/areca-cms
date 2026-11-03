import http from 'k6/http'
import { sleep } from 'k6'
import exec from 'k6/execution'
import { SharedArray } from 'k6/data'
import { Counter, Rate, Trend } from 'k6/metrics'
import { rpcRequest, decode } from './wire.js'

const fixtures = new SharedArray(
  'accounts',
  () => JSON.parse(open('./fixtures.json')).users,
)
const config = JSON.parse(open('./config.json'))
const manifest = JSON.parse(open('./manifest.json'))
const target = Number(__ENV.BENCH_VUS || 10)
const ramp = Number(__ENV.BENCH_RAMP_SECONDS || 60)
const settle = Number(__ENV.BENCH_SETTLE_SECONDS || 60)
const measure = Number(__ENV.BENCH_MEASURE_SECONDS || 600)
if (!Number.isInteger(target) || target < 1 || target > fixtures.length)
  throw new Error('Insufficient unique fixture accounts')
const latency = new Trend('bench_latency', true)
const totalLatency = new Trend('bench_total_latency', true)
const failures = new Rate('bench_failure')
const requests = new Counter('bench_requests')
const actions = new Counter('user_actions')
const semantics = new Counter('semantic_failures')
const journeyFailures = new Rate('journey_failure')
export const options = {
  scenarios: {
    users: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: `${ramp}s`, target },
        { duration: `${settle + measure}s`, target },
      ],
      gracefulRampDown: '30s',
      gracefulStop: '30s',
    },
  },
  thresholds: {
    bench_latency: ['p(95)<500', 'p(99)<1000'],
    bench_failure: ['rate<0.01'],
    bench_requests: ['count>=1000'],
    journey_failure: ['rate<0.01'],
  },
  summaryTrendStats: [
    'avg',
    'min',
    'med',
    'max',
    'p(90)',
    'p(95)',
    'p(99)',
    'count',
  ],
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
  noCookiesReset: true,
  discardResponseBodies: false,
  userAgent: 'ArecaSandboxBenchmark/1.0',
}
let state, seed
function rng() {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return (seed >>> 0) / 4294967296
}
const pick = (list) => list[Math.floor(rng() * list.length)]
function think(min = 2, max = 9) {
  sleep(min + (max - min) * Math.pow(rng(), 1.5))
}
function measured() {
  const seconds = (Date.now() - exec.scenario.startTime) / 1000
  return seconds >= ramp + settle && seconds < ramp + settle + measure
}
function record(name, res, ok, started) {
  if (measured()) {
    const kind = ok
      ? 'ok'
      : res.status === 0
        ? 'transport'
        : res.status === 200
          ? 'application'
          : 'http'
    const tags = { operation: name, status: String(res.status), kind }
    latency.add(res.timings.duration, tags)
    totalLatency.add(Date.now() - started, tags)
    failures.add(!ok, tags)
    requests.add(1, tags)
    if (!ok && res.status >= 200 && res.status < 300) semantics.add(1, tags)
    if (
      (!ok && (state.errorLogs || 0) < 5) ||
      (ok && res.timings.duration >= 500 && (state.slowLogs || 0) < 3)
    ) {
      if (!ok) state.errorLogs = (state.errorLogs || 0) + 1
      else state.slowLogs = (state.slowLogs || 0) + 1
      console.log(
        JSON.stringify({
          type: ok ? 'slow_request' : 'failed_request',
          at: new Date().toISOString(),
          vu: exec.vu.idInTest,
          operation: name,
          status: res.status,
          kind,
          duration: res.timings.duration,
          waiting: res.timings.waiting,
          errorCode: res.error_code || null,
        }),
      )
    }
  }
}
function valid(name, value) {
  if (name === 'listEntryCountsFn')
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.values(value).every((v) => Number.isInteger(v) && v >= 0)
    )
  if (name === 'getMeFn')
    return (
      value?.user?.id === state.user.id &&
      !value.mfaEnrolmentRequired &&
      !value.mfaVerificationRequired
    )
  if (name === 'listEntriesFn' || name === 'listRevisionsFn')
    return Array.isArray(value?.items)
  if (name.startsWith('list')) return Array.isArray(value)
  if (name === 'getPreviewUrlFn') return typeof value?.url === 'string'
  if (name.startsWith('delete')) return value?.ok === true
  return Boolean(value && typeof value === 'object' && value.id)
}
function rpc(name, data = {}) {
  const req = rpcRequest(config.base, manifest, name, data, state.user.cookie)
  const started = Date.now()
  const res = http.request(req.method, req.url, req.body, {
    headers: req.headers,
    redirects: 0,
    timeout: '15s',
    tags: { name },
  })
  let value,
    ok = false
  try {
    value = decode(res.body)
    ok = res.status === 200 && valid(name, value)
  } catch {
    /* failure recorded below */
  }
  record(name, res, ok, started)
  if (!ok) {
    state.failed = true
    return null
  }
  return value
}
function unique() {
  return `${config.prefix}-${exec.vu.idInTest}-${state.serial++}-${Math.floor(rng() * 1e8)}`
}
function body(title, slug) {
  return {
    title,
    slug,
    ...(state.selectedAsset ? { heroImage: state.selectedAsset } : {}),
    body: {
      type: 'doc',
      content: Array.from({ length: 5 }, (_, i) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: `${title} section ${i}. `.repeat(60) }],
      })),
    },
  }
}
function navigateSite() {
  rpc('getMeFn')
  if (Date.now() - state.sidebarAt > 60000) {
    rpc('listCollectionsFn', { siteId: state.user.siteId })
    if (manifest.listEntryCountsFn)
      rpc('listEntryCountsFn', { siteId: state.user.siteId })
    else
      for (const key of ['articles', 'news', 'pages'])
        rpc('listEntriesFn', {
          siteId: state.user.siteId,
          collectionKey: key,
          limit: 1,
          offset: 0,
        })
    rpc('listGlobalsFn', { siteId: state.user.siteId })
    state.sidebarAt = Date.now()
  }
  state.collection = pick(['articles', 'news', 'pages'])
  state.screen = 'collection'
  list()
}
function list() {
  return rpc('listEntriesFn', {
    siteId: state.user.siteId,
    collectionKey: state.collection,
    limit: 25,
    offset: state.offset || 0,
    ...state.filter,
  })
}
function openEditor() {
  const own = state.user.entries.find((e) => e.key === state.collection)
  state.entry = rpc('getEntryFn', { id: own.id })
  rpc('listCollectionsFn', { siteId: state.user.siteId })
  if (state.entry)
    rpc('getPreviewUrlFn', {
      siteId: state.user.siteId,
      collection: state.collection,
      slug: state.entry.slug,
    })
  state.screen = 'editor'
}
function documentVisit() {
  const started = Date.now()
  const res = http.get(
    `${config.base}/sites/${state.user.siteId}/c/${state.collection}`,
    {
      headers: { Cookie: state.user.cookie },
      redirects: 0,
      timeout: '15s',
      tags: { name: 'pageDocument' },
    },
  )
  const ok =
    res.status === 200 &&
    String(res.body).toLowerCase().includes('<!doctype html')
  record('pageDocument', res, ok, started)
  if (!ok) state.failed = true
}
function collectionStep() {
  if (rng() < 0.02) {
    documentVisit()
    state.sidebarAt = 0
    navigateSite()
    return
  }
  if (state.user.role === 'admin' && rng() < 0.15) {
    state.screen = 'admin'
    return
  }
  const choice = rng()
  if (choice < 0.32) openEditor()
  else if (choice < 0.49) {
    state.filter =
      rng() < 0.5
        ? { search: pick(['Sample', 'User', 'editorial']) }
        : { status: pick(['draft', 'published', 'archived']) }
    state.offset = 0
    list()
  } else if (choice < 0.6) {
    state.offset = state.offset ? 0 : 25
    list()
  } else if (choice < 0.72) {
    think(6, 22)
    const slug = unique(),
      created = rpc('createEntryFn', {
        siteId: state.user.siteId,
        collectionKey: state.collection,
        data: body(`New story ${slug}`, slug),
      })
    if (created) {
      state.created.push(created.id)
      state.entry = created
      state.screen = 'editor'
    }
    list()
  } else if (choice < 0.86) {
    state.screen = 'library'
    libraryList()
  } else if (state.user.role === 'admin' && choice > 0.94)
    state.screen = 'admin'
  else {
    state.filter = {}
    state.offset = 0
    navigateSite()
  }
}
function editorStep() {
  if (!state.entry) {
    state.screen = 'collection'
    return
  }
  const choice = rng()
  if (choice < 0.5) {
    think(5, 20) // edit several fields, then one debounced autosave
    const fresh = rpc('getEntryFn', { id: state.entry.id })
    if (fresh) {
      const saved = rpc('updateDraftFn', {
        id: fresh.id,
        expectedVersion: fresh.draftVersion,
        data: body(
          `Edited by ${state.user.email} ${state.serial++}`,
          fresh.slug,
        ),
      })
      if (saved) state.entry = saved
    }
  } else if (choice < 0.62)
    rpc('listRevisionsFn', { entryId: state.entry.id, limit: 20 })
  else if (choice < 0.7) rpc('listInboundReferencesFn', { id: state.entry.id })
  else if (choice < 0.82 && state.user.role !== 'editor') {
    const fresh = rpc('getEntryFn', { id: state.entry.id })
    if (fresh) {
      const transition = pick(['ready', 'schedule', 'archive'])
      if (transition === 'ready') {
        rpc('publishEntryFn', {
          id: fresh.id,
          expectedVersion: fresh.draftVersion,
        })
        think()
        rpc('unpublishEntryFn', { id: fresh.id })
      } else if (transition === 'schedule') {
        rpc('scheduleEntryFn', {
          id: fresh.id,
          expectedVersion: fresh.draftVersion,
          scheduledAt: new Date(Date.now() + 86400000).toISOString(),
          timezone: 'Europe/Brussels',
        })
        think()
        rpc('getEntryFn', { id: fresh.id })
        rpc('cancelScheduleFn', { id: fresh.id })
      } else rpc('archiveEntryFn', { id: fresh.id })
      state.entry = rpc('getEntryFn', { id: fresh.id })
    }
  } else if (
    choice < 0.89 &&
    state.user.role !== 'editor' &&
    state.created.includes(state.entry.id)
  ) {
    rpc('deleteEntryFn', { id: state.entry.id })
    state.created = state.created.filter((id) => id !== state.entry.id)
    state.entry = null
    state.screen = 'collection'
    list()
  } else {
    state.screen = 'collection'
    list()
  }
}
function libraryList() {
  const assets = rpc('listAssetsFn', {
    organizationId: state.user.organizationId,
    limit: 40,
    offset: rng() < 0.2 ? 40 : 0,
    search: rng() < 0.25 ? 'seed' : undefined,
  })
  if (assets?.length && rng() < 0.3) state.selectedAsset = pick(assets).id
}
function libraryStep() {
  if (rng() < 0.25) {
    const started = Date.now(),
      filename = `${unique()}.jpg`
    const res = http.post(
      `${config.base}/api/assets/upload`,
      {
        organizationId: state.user.organizationId,
        altText: 'Benchmark editorial photo',
        file: http.file(image, filename, 'image/jpeg'),
      },
      {
        headers: { Cookie: state.user.cookie, Origin: config.base },
        timeout: '20s',
        redirects: 0,
        tags: { name: 'uploadAsset' },
      },
    )
    let asset
    try {
      asset = res.json()
    } catch {}
    const ok = res.status === 200 && Boolean(asset?.id)
    record('uploadAsset', res, ok, started)
    if (!ok) state.failed = true
    if (ok) {
      rpc('updateAssetFn', {
        id: asset.id,
        altText: `Photo by user ${exec.vu.idInTest}`,
      })
      const path = `/api/assets/file/${asset.storageKey}`
      const start = Date.now(),
        file = http.get(`${config.base}${path}`, {
          headers: { Cookie: state.user.cookie },
          timeout: '15s',
          tags: { name: 'assetFile' },
        })
      record('assetFile', file, file.status === 200, start)
      if (file.status !== 200) state.failed = true
      if (state.user.role !== 'editor' && rng() < 0.5)
        rpc('deleteAssetFn', { id: asset.id })
    }
    libraryList()
  } else if (rng() < 0.5) libraryList()
  else {
    state.screen = 'collection'
    list()
  }
}
function adminStep() {
  rpc('listOrganizationsFn')
  rpc('listSitesFn', { organizationId: state.user.organizationId })
  const elapsed = (Date.now() - exec.scenario.startTime) / 1000
  if (
    elapsed < 480 &&
    state.adminCreates < 2 &&
    (state.adminCreates === 0 || rng() < 0.3)
  ) {
    think(5, 15)
    const slug = unique(),
      org = rpc('createOrganizationFn', {
        name: `Benchmark client ${slug}`,
        slug,
      })
    if (org) {
      const site = rpc('createSiteFn', {
        organizationId: org.id,
        name: 'Editorial site',
        slug: `${slug}-site`,
        productionUrl: 'https://example.invalid',
      })
      if (site)
        rpc('upsertCollectionFn', {
          siteId: site.id,
          key: 'articles',
          label: 'Articles',
          routePattern: '/articles/$slug',
          fields: [
            { key: 'title', label: 'Title', type: 'text', required: true },
            { key: 'slug', label: 'Slug', type: 'slug', required: true },
          ],
        })
    }
    state.adminCreates++
  }
  state.screen = 'collection'
  list()
}
const image = open('./photo.jpg', 'b')
export default function () {
  if (!state) {
    seed =
      (Number(__ENV.BENCH_SEED || 12345) ^ (exec.vu.idInTest * 2654435761)) >>>
        0 || 1
    state = {
      user: fixtures[exec.vu.idInTest - 1],
      screen: 'home',
      collection: 'articles',
      serial: 0,
      sidebarAt: 0,
      offset: 0,
      filter: {},
      created: [],
      adminCreates: 0,
    }
    sleep(rng() * 3)
  }
  state.failed = false
  try {
    think()
    if (state.screen === 'home') {
      documentVisit()
      navigateSite()
    } else if (state.screen === 'collection') collectionStep()
    else if (state.screen === 'editor') editorStep()
    else if (state.screen === 'library') libraryStep()
    else adminStep()
  } catch {
    state.failed = true
    state.screen = 'home'
  }
  if (measured()) {
    actions.add(1, { screen: state.screen, role: state.user.role })
    journeyFailures.add(state.failed)
  }
}
export function handleSummary(data) {
  return {
    [__ENV.BENCH_SUMMARY || 'summary.json']: JSON.stringify(
      {
        target,
        seed: __ENV.BENCH_SEED || 12345,
        ramp,
        settle,
        measure,
        metrics: data.metrics,
        thresholds: data.thresholds,
      },
      null,
      2,
    ),
  }
}
