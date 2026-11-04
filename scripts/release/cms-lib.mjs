// Versioning rules for the CMS Docker image, used by .github/workflows/cms-release.yml.
//
// The CMS version lives only in `vX.Y.Z` git tags. A release adds tags to an
// image that main already built, so nothing is committed to the repository.

// A commit that touches these gets an image (keep in step with the paths in
// cms-docker-amd64.yml). Release notes list commits under the same paths.
export const CMS_PATHS = [
  'apps/cms',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  '.dockerignore',
  '.github/workflows/cms-docker-amd64.yml',
  '.github/workflows/cms-docker-arm64.yml',
  'docker',
]

const VERSION = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

// `v1.2.3` → [1, 2, 3]. Anything else, pre-releases included, is null.
export function parseVersion(tag) {
  const match = VERSION.exec(tag)
  return match ? match.slice(1).map(Number) : null
}

export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

// The `vX.Y.Z` tags from a list of git tags, highest first.
export function releaseTags(tags) {
  return tags.filter((tag) => parseVersion(tag)).sort((a, b) => compareVersions(b, a))
}

// Accepts `1.2.3` too, for convenience.
export function normalizeVersion(input) {
  const tag = input.trim().startsWith('v') ? input.trim() : `v${input.trim()}`
  if (!parseVersion(tag)) {
    throw new Error(`"${input}" is not a version. Use vX.Y.Z, for example v0.1.0 (pre-releases are not supported).`)
  }
  return tag
}

export function bumpVersion(tag, bump) {
  const [major, minor, patch] = parseVersion(tag)
  if (bump === 'major') return `v${major + 1}.0.0`
  if (bump === 'minor') return `v${major}.${minor + 1}.0`
  if (bump === 'patch') return `v${major}.${minor}.${patch + 1}`
  throw new Error(`Unknown bump "${bump}". Use patch, minor or major.`)
}

// The version to release: `version` if given, otherwise `bump` applied to the
// highest existing version.
export function resolveVersion({ tags, version, bump }) {
  if (version) return normalizeVersion(version)
  const [highest] = releaseTags(tags)
  if (!highest) {
    throw new Error('There is no vX.Y.Z tag to bump from yet. Run the first release with an exact version, such as v0.1.0.')
  }
  return bumpVersion(highest, bump)
}

// The tags that follow the newest release, and whether this release moves
// them. `vX.Y` follows the newest patch of X.Y and `latest` follows the newest
// version, so tagging an older build never moves them backwards. `tags` may
// already include `version` (a pushed tag, or a re-run).
export function movingTags({ tags, version }) {
  const [major, minor] = parseVersion(version)
  const minorTag = `v${major}.${minor}`
  const others = releaseTags(tags).filter((tag) => tag !== version)
  const isNewest = (candidates) => candidates.every((tag) => compareVersions(version, tag) > 0)
  const sameMinor = others.filter((tag) => tag.startsWith(`${minorTag}.`))
  const moved = []
  if (isNewest(sameMinor)) moved.push(minorTag)
  if (isNewest(others)) moved.push('latest')
  return { minorTag, moved, latest: moved.includes('latest') }
}

// The highest version below `version`: release notes start after it.
export function previousVersion({ tags, version }) {
  return releaseTags(tags).find((tag) => compareVersions(tag, version) < 0) ?? null
}
