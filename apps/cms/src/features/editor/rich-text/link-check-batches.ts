/**
 * The link checks of a text are sent in batches: the server takes at most this
 * many links per call (`LINK_CHECK_MAX` in server/fn/link-targets.ts). A text
 * with more links was not checked at all before.
 */
export const LINK_CHECK_BATCH = 200

/**
 * Runs `check` on the links in batches of at most `size`, one after the other,
 * and returns every answer in the order of the links.
 */
export async function checkInBatches<TLink, TResult>(
  links: TLink[],
  check: (batch: TLink[]) => Promise<TResult[]>,
  size: number = LINK_CHECK_BATCH,
): Promise<TResult[]> {
  const results: TResult[] = []
  for (let start = 0; start < links.length; start += size) {
    results.push(...(await check(links.slice(start, start + size))))
  }
  return results
}
