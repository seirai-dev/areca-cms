# Audit fixes: security, speed, cleanup (13 Nov 2026)

## Intent

A full audit (11 auditors, independent verifiers, Codex cross-check) found real security holes, avoidable slowness and a lot of duplicated code. Goal: make Areca as safe as possible, faster and smaller, **without changing behaviour** except where a security fix or a decision below requires it.

Non-goals: new features, visual redesign. Anti-goals: anything that breaks an existing flow, changes the published snapshot bytes/hash, or weakens the link-index lock order (`lockSiteLinkIndex` first, see AGENTS.md).

Full evidence per item: the audit reports (sec-*.md, perf-*.md, quality-*.md, verify-*.md, codex-review.md) kept outside the repo; each item below names files.

## Decisions (by the owner)

- Fix S1–S10 and S12. Skip S11 (dev compose binding) and S13 (per-account sign-in limit).
- S2/S3 **strict**: an invitation whose link was shown to the inviter no longer marks the email verified; `requireLocalEmailVerified` goes back to better-auth's default (true); the per-session second-factor check applies to every user with 2FA on, so social/SSO sign-in no longer skips TOTP.
- The UI enforces the same publishing-mode rules as MCP: no switching back to demo after the site went live, production requires a deployment target. Rule lives in the service (`admin/sites.ts`), MCP calls it, checked under the org lock.
- Do all of P-A, P-B, C-A, C-B, C-C.

## Approaches considered

1. **One big branch** — simplest to run, impossible to review, one bad change blocks everything.
2. **Six stacked branches by theme (chosen)** — each reviewable alone, risky restructures last so the safe wins can merge first.
3. **Parallel independent branches off #144** — conflicts in `entries.ts`, `worker.ts`, `snapshot.ts` across themes; rejected.

Within a branch, subagents work in separate worktrees on disjoint files and their commits are merged into the branch.

## Branches and contents

### 1. `fix/audit-security` (on #144)
- S1 seroval override `>=1.6.12 <1.7.0` (pnpm-workspace.yaml) + reinstall.
- S2/S3 as decided (lib/auth.ts, server/admin/members.ts ~798, security/local-mfa.ts, me.ts guards).
- S4 replace quadratic regexes in server/richtext/markdown.ts (escapeText, serializeTableCell) and from-markdown.ts (trimRun) with the verified linear versions; perf regression test.
- S5 Dokploy: reuse stored key only if URL unchanged (server/admin/dokploy-credentials.ts), update its test.
- S6 safeRedirectPath rejects backslashes/control chars/whitespace and requires same-origin.
- S7 `priority` restricted to 0|100 for HTTP callers (server/fn/publishing.ts).
- S8 "scheduled" decided by system actor only, note capped at 500 chars (publishing/publications.ts).
- S9 upload sessions store the creating credential (key id / OAuth connection id) and refuse uploads once revoked (migration).
- S10 outbound-url.ts reuses the full address classifier from assets/remote.ts (shared module); mail/hosts.ts too.
- S12 archiveEntry in one transaction (with link-index lock order).

### 2. `perf/audit-quick-wins` (P-A)
PERF-S-3/C-3 drop snapshots and build logs from polled lists (separate fetch where logs are shown); S-4/S-5/S-14 indexes + drop redundant indexes, stop per-autosave audit rows; S-12 slim site selects in access guards; S-6 batch preview asset lookups; S-7 slim autosave response; C-1 lazy editor; C-2 move tab constants; C-4 sidebar failed-build field on overview; C-9/S-13 global staleTime 30s.

### 3. `refactor/audit-server-cleanup` (C-A)
QS-9 shared Tx type / stableJson / isPlainObject / getSite helper; QS-10 + QP-13 dead code; QP-7; QP-6 one advisory-lock helper (correct unlock semantics); QP-10 one preview-link builder; QS-3 worker interval helper; QP-2 one site-access guard + one org-role lookup (agency admin wins consistently — keep MCP semantics; check notification recipients).

### 4. `perf/audit-deep` (P-B)
S-1 release-diff cache + grouped dashboard query (+S-23 skip unchanged manifest writes); S-2 siteAssets via targeted queries; S-9 assetUsage without org exclusive lock; S-10 link picker batching; S-11 GIN index for translated slug check; S-15..S-25 as listed; C-5 thumbnails + srcset; C-6 editor keystroke work; C-7 route loaders; C-8 preview debounce 400ms/max 1s; C-10..C-20 bundle trims; infra: compressPublicAssets, no public source maps in image.

### 5. `refactor/audit-client-cleanup` (C-C)
QC-1..QC-14.

### 6. `refactor/audit-server-restructure` (C-B)
QS-1 (shared entry commit path, split entries.ts), QS-2, QS-4, QS-5 (snapshot hash byte-identical), QS-6, QS-7, QS-8, QP-1 (publishing-mode rule in service, decided above), QP-3 (authz matrix keyed by export, generated AUTHZ_MATRIX.md), QP-5, QP-8, QP-9, QP-11, QP-12, QP-14, QP-15.

## Verification

Per branch: `pnpm typecheck`, `pnpm lint`, full vitest incl. integration (own test DB per agent), build. Then e2e (isolated DB) and a manual browser pass of the main flows (sign-in with 2FA, sites, editor incl. rich text and visual mode, media, go-live, agency people/settings, MCP connect) with desktop + mobile screenshots before PRs are opened.

## Left to the builder
File splits' exact seams, helper names, test additions, ordering inside a branch.
