# Browser regression verification — 10 October 2026

The CMS ran locally on port 3100 against the isolated `areca_audit_full` database with publishing workers disabled and the seeded test administrator's MFA requirement disabled. No setup/reset suite ran. All created media pagination rows were removed after the test.

| Issues | Check                                                                                                                                             | Result                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 36/37  | Image picker excludes 50 PDFs before pagination, loads 40 → 80 → 85 unique images, stops offering Load more, and rejects a PDF upload             | Playwright pass                                                    |
| 40     | Optional five-choice dropdown selects and visibly clears its value                                                                                | Playwright pass after fixing Radix controlled empty-value behavior |
| 44     | Collection key follows every typed label character, then stays fixed after manual key editing                                                     | Playwright pass                                                    |
| 45     | `Paris, France` stays one option after saving and reopening the schema                                                                            | Playwright pass                                                    |
| 48/49  | Two newly created sites each reveal separate build/schema credentials; all four survive reload; confirming one site's pair keeps the other's pair | Playwright pass                                                    |
| 38     | Local PNG logo upload/removal preserves an unsaved branding name after removal completes                                                          | Collaborative T3 manual pass                                       |
| 39     | Unsaved site name survives Developer → General tab switching and remains visible in General                                                       | Collaborative T3 manual pass                                       |

Three tests in `apps/cms/e2e/audit-ui.spec.ts` passed. Three additional focused branding, site/client-tab and mocked-AI-key-removal journeys passed; the AI mock confirms model, prompt and typed replacement-key drafts survive key removal. The media test explicitly requires the isolated browser database before inserting dummy rows. The shared helpers now capture build and schema credentials separately and use the schema credential for manifest writes.

The collaborative browser initially retained a connection-error page. Explicit cache-busted navigation restored access. Authentication at 127.0.0.1 correctly rejected the origin while authentication at the configured localhost origin succeeded; no trust rules changed.

The demo production client, SSR and Nitro builds passed using existing fixture content, and all three generated article pages passed `verify:prerender`. No CMS content pull was performed during that build.

No live AI key verification, AI generation, hosting deployment or production SSO flow was exercised. Opening the AI settings screen can fetch public model-catalogue metadata; it was not used to verify provider credentials or generate content. The mocked AI removal test intercepts settings/model server functions before opening the page and does not contact OpenRouter.

Additional targeted Playwright regressions passed on the same isolated server:

- Branding metadata drafts (name, accent, sender) survive immediate logo upload and removal; saved branding still appears after sign-out.
- Unsaved site and client names survive visiting another settings tab and returning.
- AI key removal preserves unsaved model, system prompt, and typed replacement key. All AI settings/model/removal server-function responses were mocked before navigation; no real provider key verification or generation ran.

The checks are in `e2e/branding.spec.ts` and `e2e/audit-drafts.spec.ts`. The initial AI check used the wrong confirmation role locator; after correcting it to `alertdialog`, the focused rerun passed.

The final sized-image follow-up passed 60 CMS rich-text tests and 118 SDK tests.
React sites use the optional `@areca-cms/site-sdk/rich-text-react` adapter to
remove empty children from TanStack's generated void-image components while
preserving chosen dimensions. The core SDK/CLI do not import React. The demo
uses the adapter and was rebuilt successfully after that change; six pages
prerendered and three article-page checks passed again.
