# Troubleshooting

The CMS cannot tell a blocked frame from a page without a bridge: both end at "Updates on save" after 3 seconds. Check from the site side first.

## Quick checks

Run these against the preview URL (open one from the CMS "Open preview in a new tab" button, or the MCP `get_preview_url` tool):

```bash
curl -sI "<preview url>" | grep -i -E "content-security-policy|x-frame-options|cache-control|x-robots-tag"
# expect: content-security-policy: frame-ancestors 'self' https://<cms host>
#         no x-frame-options line, cache-control: no-store, x-robots-tag: noindex, nofollow
curl -sI "<public url of the same page>" | grep -i -E "content-security-policy"   # expect no frame-ancestors
curl -s "<public url>" | grep -c "data-areca-"                                    # expect 0
```

In the browser devtools of the CMS tab, the iframe's console shows the bridge's warnings (`Live preview: could not resolve update …`) and CSP errors (`Refused to frame …`).

## Symptoms

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Preview is blank or shows a browser error | The response has no `frame-ancestors` for the CMS origin, or sends `X-Frame-Options`, or a site-wide CSP replaced it | Send `visualEditingHeaders({ cmsOrigin })` on preview responses, merge it into an existing CSP, remove `X-Frame-Options` there. |
| Blank, and the Preview URL is `http://` on a host other than localhost | The production CMS frames only `https:` plus `localhost`/`127.0.0.1` | Use HTTPS, or `http://localhost:<port>`. |
| Blank in a hosted environment, fine locally | `ARECA_CMS_URL` is missing at run time, so `cmsOrigin` is `null` and no header is sent | Set `ARECA_CMS_URL` (and `ARECA_SITE_TOKEN`) in the runtime environment, not only at build time. |
| "Preview unavailable" / 401 inside the frame | Token expired (1 hour) or for another site; `ARECA_SITE_TOKEN` or `ARECA_CMS_URL` wrong on the server | Reload the preview from the CMS. Check the env vars point at the CMS that issued the link. |
| 404 inside the frame | No route for `/__preview/<collection>/<slug>`, the router dropped the `__` prefix, or the page shows a public 404 for drafts | TanStack: folder `[__preview]`. Next.js: folder `%5F_preview`. Make the route render any collection the CMS can preview. |
| The public page shows instead of the draft (site content) | The page ignores `?arecaPreview=`, or a static copy or CDN served it | Read the token in the loader, and let requests with `arecaPreview` reach the server. |
| Stuck on "Updates on save" | Bridge not running: the page does not call `useLivePreview` / `createVisualBridge`, `cmsOrigin` is `null`, or it is not the exact CMS origin (scheme, host, port) | Pass the origin of `ARECA_CMS_URL` from the server loader. Compare it with the CMS address bar. |
| "Live", but the page never changes | `resolve` or `onUpdate` fails, returns the same data, or the page renders loader data instead of the hook's value | Check the console warning. Render from the hook's return value. For a section page, `previewing` must equal that page's section key (camelCase). |
| "Retrying…" | The CMS could not build the live result (a CMS-side failure or the per-user rate limit) | Usually transient. Nothing to change on the site. |
| Live page flashes back to old values | Results applied without seq ordering | Use `createLatestResolver`, or the React hook. |
| Live page breaks while typing | The render assumes required fields exist | Handle `complete: false` and show `issues`. Drafts can have empty required fields. |
| `Preview collection "x" is not in the generated schema` | The pulled types are older than the CMS schema | Run `areca pull` (after a go live) so `areca.gen.ts` knows the collection. |
| `Preview token is for site content "x". Use previewGlobals() for it.` | A section result reached `previewFrom` | Route `kind: "global"` results to `content.previewGlobals`. |
| `Not a CMS URL: …` | `createVisualBridge` or `visualEditingHeaders` got a value without a scheme, or a `file:` URL | Use `cmsOriginFrom` and pass `null` when the variable is unset. |
| Nothing is outlined or clickable | Markers off on that route, a key matches no field, the owner failed the CMS check, Browse mode is on, or Alt is held | Check the HTML for `data-areca-field`, the key spelling (camelCase or raw), the owner id (`entry.id`, not slug). |
| Header or footer fields not clickable | Markers enabled only inside the page component, or no `{ global: key }` owner | Enable markers for the whole layout on preview pages and pass the section owner. |
| A referenced entry's fields not clickable | Missing `{ entry: id }` owner, or the target is archived, deleted or not editable by the user | Pass the owner. Archived and other-site entries are never clickable. |
| Links in the preview don't open | They are marked, so Select mode opens the field | Expected. Use Browse, or hold Option/Alt. |
| Esc does not leave full screen | No bridge on the page | Esc is forwarded by the bridge. Use the Exit full screen button otherwise. |
| Some markers missing on a long page | More than 500 markers | Mark lists and sections, not every repeated item. |
| Preview shows the main language | Initial load and "Updates on save" use the main language; live updates use the editor's | Get the site to "Live". Don't force `locale` in `previewFrom`. |
| "You're viewing another page." | The preview navigated away from the entry's page (a click in Browse mode, or a redirect) | Expected. If it appears right after load, the preview route redirects; make it render in place. |
