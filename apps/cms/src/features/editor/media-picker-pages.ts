/** Ignore each lookahead row and merge pages without duplicate asset tiles. */
export function visiblePickerAssets<T extends { id: string }>(
  pages: T[][],
  pageSize: number,
): T[] {
  const visible = new Map<string, T>()
  for (const page of pages) {
    for (const asset of page.slice(0, pageSize)) visible.set(asset.id, asset)
  }
  return [...visible.values()]
}
