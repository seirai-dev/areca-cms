# Releasing

This covers the CMS Docker image. The npm packages (`@areca-cms/site-sdk` and
`@areca-cms/skills`) release through their own release PRs; see the comments
in `.github/workflows/release.yml`.

## How CMS versions work

- Every push to `main` that touches the CMS builds an image tagged
  `sha-<commit>` and `edge` (after CI passes).
- A **release** gives one of those images a `vX.Y.Z` version. It does not
  rebuild anything. It adds tags to the image that already passed CI, so the
  release is exactly what was tested.
- The version exists only as a git tag (`v0.1.0`). Nothing is committed, so
  there is no release PR to merge.

A release adds these tags:

| Tag      | When it moves                                                         |
| -------- | --------------------------------------------------------------------- |
| `vX.Y.Z` | Never. Once published, a version always means the same image.         |
| `vX.Y`   | When this is the newest patch of `X.Y`.                               |
| `latest` | When this is the newest version overall.                              |

It also creates the git tag `vX.Y.Z` and a GitHub Release named
"Areca CMS vX.Y.Z", with the commits since the previous version as notes. The
newest version is marked "Latest" on GitHub.

Only plain `vX.Y.Z` versions are allowed (no `-rc.1`). Only commits on `main`
can be released.

## Release the newest build

Wait until the **CMS Docker AMD64 and multi-platform release** run for the
latest CMS commit on `main` has finished. Then pick one of these.

**From the GitHub website:** Actions → **CMS release** → **Run workflow**.
Choose `patch`, `minor` or `major`, leave the other fields blank, and run it.

**From your terminal:**

```sh
gh workflow run cms-release.yml -f bump=patch    # v0.1.0 → v0.1.1
gh workflow run cms-release.yml -f bump=minor    # v0.1.1 → v0.2.0
gh workflow run cms-release.yml -f bump=major    # v0.2.0 → v1.0.0
gh workflow run cms-release.yml -f version=v0.3.0   # an exact version
```

**By pushing a git tag yourself:**

```sh
git fetch origin
git tag v0.1.1 origin/main
git push origin v0.1.1
```

The tag must point at a `main` commit that built an image. Pushing a tag runs
the same workflow.

Follow the run with `gh run watch`. When it finishes, the image can be pulled:

```sh
docker pull ghcr.io/seirai-dev/areca-cms:v0.1.1
```

### Which bump?

While the version is below `1.0.0`:

- **patch** for fixes only.
- **minor** for new features, and for anything that breaks existing installs
  (removed or renamed environment variables, a migration that needs manual
  steps, changed API behaviour). Say what breaks in the release notes.
- **major** only when you go to `1.0.0`.

From `1.0.0` on, use normal semver: breaking changes go in a major release.

## The first release

There is no version to bump from yet, so give an exact one:

```sh
gh workflow run cms-release.yml -f version=v0.1.0
```

After that, `bump` works.

## Give an older build a version

Pass the commit and an exact version:

```sh
gh workflow run cms-release.yml -f version=v0.0.19 -f commit=<full-or-short-sha>
```

To find the commits that have an image, list the successful image builds on
`main`:

```sh
gh run list --workflow cms-docker-amd64.yml --branch main --status success \
  --limit 50 --json headSha,displayTitle,createdAt \
  --jq '.[] | "\(.headSha[0:9])  \(.createdAt[0:10])  \(.displayTitle)"'
```

Tagging an older build never moves `latest`, and moves `vX.Y` only if it is the
newest patch in that line. For example, with `v0.1.0` released, tagging an older
build as `v0.0.19` adds `v0.0.19` and `v0.0`, and leaves `latest` and `v0.1`
alone.

Give older builds versions in increasing order (`v0.0.1` on the oldest commit,
and so on). The workflow does not check that versions follow commit order.

## When something goes wrong

- **"There is no …:sha-<commit> image"**: the build for that commit is still
  running, failed, or never ran (the commit did not touch the CMS). Wait for it,
  or pass another commit.
- **"… already exists"**: versions never move. Pick the next version.
- **A run failed halfway**: re-run it from the Actions tab. Steps that already
  happened are checked and skipped. If you started it with `bump` and the GitHub
  Release was already created, don't re-run it: the version is out, and a re-run
  would bump again.
- **A bad release**: don't delete or move its tag. Fix forward with a new patch
  release, and add a warning to the bad release's notes on GitHub.

You can edit the release notes on GitHub after the release, for example to add
upgrade steps.

## Before the repository goes public

The container package's visibility is separate from the repository's. After the
first release, open the repository's **Packages** entry → **Package settings** →
**Change visibility** → **Public**, so people can pull without logging in.
