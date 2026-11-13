import { useCallback, useMemo, useState } from 'react'

/** Ticks `id` on or off; with `on` left out, flips it. */
export function toggledSelection(
  current: ReadonlySet<string>,
  id: string,
  on = !current.has(id),
): ReadonlySet<string> {
  const next = new Set(current)
  if (on) next.add(id)
  else next.delete(id)
  return next
}

/**
 * A set of ticked ids. Given `visibleIds`, the selection only ever covers
 * those: a filter change narrows it without a reset effect.
 */
export function useSelection(visibleIds?: readonly string[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

  const picked = useMemo(() => {
    if (!visibleIds) return [...selected]
    return visibleIds.filter((id) => selected.has(id))
  }, [selected, visibleIds])
  const pickedSet = useMemo(() => new Set(picked), [picked])

  const toggle = useCallback((id: string, on?: boolean) => {
    setSelected((current) => toggledSelection(current, id, on))
  }, [])
  const toggleAll = useCallback(
    (on: boolean) => setSelected(new Set(on ? visibleIds : [])),
    [visibleIds],
  )
  const clear = useCallback(() => setSelected(new Set()), [])
  const replace = useCallback(
    (ids: Iterable<string>) => setSelected(new Set(ids)),
    [],
  )

  return {
    picked,
    isSelected: (id: string) => pickedSet.has(id),
    toggle,
    toggleAll,
    clear,
    replace,
  }
}
