/*
 * Route loaders start the queries a page shows, with the same options the
 * screens use, so the data loads next to the page's code (and on hover). The
 * browser never waits for them: each screen keeps its own loading and error
 * states. Pass `queryClient.prefetchQuery(...)` calls: they never reject, so
 * a failed request stays a query error for the screen to show.
 *
 * On the server a query either finishes before the HTML is rendered or is
 * not started at all. A query still in flight there could render data the
 * browser does not have yet when it hydrates. Data whose rendering depends on
 * the clock or time zone ("4m ago", dates) is not rendered on the server at
 * all, because the browser would render different text.
 */

const inBrowser = () => typeof window !== 'undefined'

/** Starts the queries in the browser; on the server, waits for them. */
export function awaitOnServer(
  ...prefetches: Array<() => Promise<unknown>>
): Promise<void> | undefined {
  const started = prefetches.map((start) => start())
  if (inBrowser()) return undefined
  return Promise.all(started).then(() => undefined)
}

/** Starts the queries in the browser only; the server renders the loading state. */
export function prefetchInBrowser(...prefetches: Array<() => unknown>) {
  if (!inBrowser()) return
  for (const start of prefetches) void start()
}
