# Audit implementation tracker

User approved findings 01–50 except 21, which remains unchanged. The source findings are in [AUDIT-2026-10-10.md](./AUDIT-2026-10-10.md).

Implementation used three GPT-6.1 Sol Medium agents in parallel. Regression tests use isolated local services; no production services were used.

| Owner                                      | Findings            | State                                                                    |
| ------------------------------------------ | ------------------- | ------------------------------------------------------------------------ |
| Security/admin agent                       | 01–10, 38–40, 44–49 | Implemented; security, form and browser regressions passed               |
| Publishing agent                           | 12–20, 22, 41, 42   | Implemented; publishing, cleanup and recovery regressions passed         |
| SDK/content agent                          | 18 SDK, 23–35, 50   | Implemented; content regressions and resized-image renderer tests passed |
| Coordinator, reviewed by SDK/content agent | 11, 36, 37, 43      | Implemented; media access, paging, AI and browser regressions passed     |

Confirmed behavior decisions:

- AI media: assets referenced by this site's content, plus uploads through its AI connection. The normal client library remains shared.
- Shared hosting applications: deployments serialize; developer build logic combines site content.
- MFA reset: another agency admin after fresh MFA; operator recovery clears lockout only.
- Release and storage retries: initial attempt plus three retries (1, 5, 15 minutes), then manual retry.
- Revision restore: retain current draft values for incompatible fields and list skipped fields.
- Site deletion leaves the hosted website running and blocks unresolved deployments.

The table below records each approved finding and its resulting behavior. Browser evidence is recorded in [AUDIT-BROWSER-2026-10-10.md](./AUDIT-BROWSER-2026-10-10.md).

## Implemented changes

| Issue | Result                                                                                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 01    | First account creation requires the setup token.                                                                                        |
| 02    | Password registration requires the invitation link; provider email ownership is verified.                                               |
| 03    | Initial account, credentials and setup audit commit together.                                                                           |
| 04    | Invitation acceptance, revocation and creation use consistent locks.                                                                    |
| 05    | Repeating acceptance succeeds for the same existing member.                                                                             |
| 06    | Client deletion refuses clients with sites, including concurrent site creation.                                                         |
| 07    | Failed MFA checks share a serialized account budget; another freshly verified admin or operator recovery can reset it.                  |
| 08    | Duplicate pending invitations and invitations for existing members are rejected.                                                        |
| 09    | Invitation email values are escaped.                                                                                                    |
| 10    | Admin sessions need local MFA proof, including provider logins.                                                                         |
| 11    | AI media access follows actual site image references and that site's AI uploads; ordinary text cannot grant access.                     |
| 12    | Shutdown waits for claimed work within its timeout and leaves recoverable durable state.                                                |
| 13    | Releases sharing a hosting application serialize, including unresolved legacy jobs.                                                     |
| 14    | Scheduled releases stop after the initial attempt plus three retries; manual retry starts a new cycle.                                  |
| 15    | Demo comparisons use the latest successful demo publication.                                                                            |
| 16    | Hosting connection changes and removal are blocked while deployments are unresolved; same-URL API key rotation remains allowed.         |
| 17    | Site deletion blocks unresolved jobs and leaves hosting running.                                                                        |
| 18    | Ordinary pulls use the latest successful publication; builds explicitly pin theirs.                                                     |
| 19    | Backlog is a gauge; total failures use a durable cumulative counter.                                                                    |
| 20    | Transfers preserve and remap scheduled approval attribution.                                                                            |
| 21    | Skipped as requested.                                                                                                                   |
| 22    | Recovery configuration checks both deployment and AI encryption keys.                                                                   |
| 23    | Rich-text publication preserves editor structure and image sizes, escapes exports, and provides an optional SDK React renderer adapter. |
| 24    | Mixed-case identifiers work; case-insensitive collisions are rejected.                                                                  |
| 25    | Malformed rich text is rejected before empty-value checks or traversal.                                                                 |
| 26    | References can use an existing approved version while its replacement is scheduled.                                                     |
| 27    | Publication detects collisions between resolved page URLs and explains how to fix them.                                                 |
| 28    | SDK pulls switch one manifest pointer only after a complete new generation is ready.                                                    |
| 29    | SDK initialization honors custom schema and output paths.                                                                               |
| 30    | Nonexistent calendar dates and invalid times are rejected.                                                                              |
| 31    | Demo articles render SEO metadata, structured data, summaries, takeaways and FAQs.                                                      |
| 32    | Schema relationships are validated and invalid updates roll back.                                                                       |
| 33    | Removed collections cannot be read from the current SDK manifest.                                                                       |
| 34    | Previews contain only fields declared by the current schema.                                                                            |
| 35    | Revision restores retain incompatible current values and list skipped fields; schema changes serialize with restore.                    |
| 36    | Media pagination uses bounded page requests, deterministic ordering and duplicate suppression when uploads overlap pages.               |
| 37    | Image-only filtering happens before pagination; dropped PDFs are refused.                                                               |
| 38    | Logo and saved-key actions preserve unrelated form drafts.                                                                              |
| 39    | Visited settings panels stay mounted so switching tabs preserves drafts.                                                                |
| 40    | Optional dropdowns include a clear action.                                                                                              |
| 41    | Uploads and replacements have durable cleanup, bounded retries and registration fences against concurrent deletion.                     |
| 42    | Invalid image bytes, MIME mismatches and oversized decoded images produce a clear validation error.                                     |
| 43    | Unreadable AI images are skipped with warnings; descriptions stay aligned with attachments.                                             |
| 44    | Generated collection keys follow label edits until manually changed.                                                                    |
| 45    | Choice editing preserves commas, quotes and whitespace.                                                                                 |
| 46    | Provider request failures clear the busy state and allow retry.                                                                         |
| 47    | Security confirmations queue; cancelled requests and stale responses cannot settle another confirmation.                                |
| 48    | New-site setup reveals both build and schema credentials.                                                                               |
| 49    | Pending credential reveals persist independently for each site.                                                                         |
| 50    | CMS, SDK and demo use the same current Markdown version.                                                                                |

## Verification

The combined CMS database suite passed **1,588 tests**, with 14 skips. Thirteen skipped tests require the separate isolated authentication database and passed in their dedicated run; one requires live AI credentials and was intentionally not exercised. The CMS production build and client-bundle secret scan passed. The final combined run includes the last UI and rich-text refinements. The rich-text suite separately passed 60 tests, including actual SDK React rendering of resized images and escaped attributes.

Additional checks passed: SDK 118 tests, demo 7 tests, CMS maintenance scripts 24 tests, recovery configuration 4 tests, isolated actual-MFA regressions, TypeScript checks and whitespace checks. Three audit UI browser tests and three targeted branding/settings/AI draft tests passed. SDK and demo production builds passed; the demo prerendered six pages and all three article checks passed. Scoped lint passed; existing database empty-row checks still require their documented rule exceptions.

Migration `apps/cms/drizzle/0019_audit_reliability.sql` was generated and verified on isolated test databases. It has not been applied to the existing development or production database. No production deployment or real hosting-provider dispatch was performed. External SSO, live AI generation and an end-to-end production recovery drill were not exercised. The cumulative failure baseline includes retained failed jobs; already-deleted historical failures cannot be reconstructed. Recovery still requires the original encryption keys.
