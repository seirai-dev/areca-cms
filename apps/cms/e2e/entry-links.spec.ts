import { expect, test } from '@playwright/test'
import { Pool } from 'pg'

import {
  backToCollection,
  createIsolatedAcmeSite,
  entryIdFromUrl,
  siteIdFromUrl,
  login,
  markAsReady,
  openCollection,
  openGoLivePanel,
  openSite,
  richText,
  startNewEntry,
  uniqueSuffix,
  waitForSaved,
  writeArticle,
  OWNER,
} from './helpers'

/**
 * A rich text link to another entry. The editor's entry link picker is a later
 * change, so the link is written into the source's draft directly (the e2e
 * database is isolated; see scripts/e2e-isolated.mjs). Everything else goes
 * through the UI: the entries, Mark as ready, and the Go live list.
 */
test('Go live lists a link to an entry that is not live, and clears it once the target is ready', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const suffix = uniqueSuffix()
  const targetTitle = `E2E Target ${suffix}`
  const sourceTitle = `E2E Source ${suffix}`
  const { siteSlug } = await createIsolatedAcmeSite(page, `lnk-warn-${suffix}`)

  await login(page, OWNER)
  await openSite(page, siteSlug)
  const siteId = siteIdFromUrl(page)
  await openCollection(page, 'articles')

  // The target: a draft, so it is not in the next release.
  await startNewEntry(page)
  await writeArticle(page, targetTitle, 'The page the link goes to')
  await waitForSaved(page)
  const targetId = entryIdFromUrl(page)

  // The source: plain text for now. The editor hides the sidebar, so go back first.
  await backToCollection(page)
  await startNewEntry(page)
  await writeArticle(page, sourceTitle, 'Read the target')
  await waitForSaved(page)
  const sourceId = entryIdFromUrl(page)

  // Write the entry link into the source's draft, with the index row the
  // CMS keeps for it. The text is the paragraph; the link wraps all of it.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const body = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Read the target',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: '/placeholder',
                    entryId: targetId,
                    collection: 'articles',
                    anchor: null,
                  },
                },
              ],
            },
          ],
        },
      ],
    }
    const row = await pool.query(
      `update entry set draft_data = jsonb_set(draft_data, '{body}', $2::jsonb, true), draft_version = draft_version + 1, content_version = content_version + 1
       where id = $1 returning site_id`,
      [sourceId, JSON.stringify(body)],
    )
    expect(row.rowCount).toBe(1)
    await pool.query(
      `insert into entry_link (id, site_id, source_entry_id, locale, field_key, target_entry_id, anchor)
       values (gen_random_uuid()::text, $1, $2, '', 'body', $3, '')`,
      [row.rows[0].site_id, sourceId, targetId],
    )
  } finally {
    await pool.end()
  }

  // Reload the source so the editor shows the link, then mark it ready.
  await page.goto(`/sites/${siteId}/c/articles/${sourceId}`)
  await expect(
    richText(page).locator('a', { hasText: 'Read the target' }),
  ).toHaveCount(1)
  await markAsReady(page)

  // The link points at a draft: Go live warns, and the release goes on.
  await backToCollection(page)
  await openGoLivePanel(page)
  const warnings = page.getByTestId('golive-link-warnings')
  await expect(warnings).toBeVisible()
  await expect(warnings).toContainText('1 link will not work after go live')
  await expect(warnings).toContainText(sourceTitle)
  await expect(warnings).toContainText(
    `Links to ${targetTitle}, which is not live`,
  )
  await warnings.getByText(sourceTitle).click()
  await expect(page).toHaveURL(new RegExp(`/c/articles/${sourceId}`))

  // Ready the target: the next release contains it, and the warning clears.
  await page.goto(`/sites/${siteId}/c/articles/${targetId}`)
  await markAsReady(page)
  await backToCollection(page)
  await openGoLivePanel(page)
  await expect(page.getByTestId('golive-link-warnings')).toHaveCount(0, {
    timeout: 15_000,
  })
})
