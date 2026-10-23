/** This device first, then the rest, most recently active first. */
export function orderSessions<
  T extends { current: boolean; updatedAt: string | Date },
>(sessions: readonly T[]): T[] {
  return [...sessions].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}
