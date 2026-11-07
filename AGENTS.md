<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

## Links in rich text

Links to pages of the same site are entry links. Read `docs/design/rich-text-links.md` before changing one.

- **Stored shape.** A link is the `link` mark: `href` (the target's main-language path, kept for old readers), plus `entryId`, `collection` and `anchor` for an entry link. Validation is in `server/richtext/allowlist.ts` and `validate.ts`.
- **Save check.** `prepareEntryLinks` (`server/content/entry-links.ts`) rejects an id that is not a routed entry of the site (or of its production site, for a development environment) and recomputes `href` and `collection`.
- **Import.** `resolveMarkdownLinkTargets` (`server/content/link-targets.ts`) resolves every `entry:<id>`, site path and own-domain URL of a write in one batch. The converter `markdownToRichText` (`server/richtext/from-markdown.ts`) stays synchronous and only reads that map.
- **Export.** `richTextToMarkdown` writes `entry:<id>[#anchor]`. The editor preview and translation pass `entryLinkForm: 'hrefs'` to keep the stored path.
- **Go live.** The snapshot (`server/content/snapshot.ts`) resolves each link to its target's path in the text's language, with `placeLinkTarget`.
- **Link index.** `server/content/entry-link-index.ts` keeps one row per entry link. Any transaction that writes those rows must take `lockSiteLinkIndex(tx, siteId)` before any other row write or lock. Without it, two saves of one site can deadlock.
