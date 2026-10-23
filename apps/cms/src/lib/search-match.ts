/**
 * Search-box matching: every word of the query must appear in the item's text.
 * Case and diacritics are ignored ("Vóór" finds "voor"), and case is folded
 * for the UI language, so Turkish dotted and dotless i fold the way a Turkish
 * reader expects.
 */
export function foldForSearch(text: string, locale: string): string {
  return text.toLocaleLowerCase(locale).normalize('NFD').replace(/\p{M}/gu, '')
}

export function matchesSearch(
  query: string,
  texts: readonly string[],
  locale: string,
): boolean {
  const words = foldForSearch(query, locale).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = foldForSearch(texts.join(' '), locale)
  return words.every((word) => haystack.includes(word))
}
