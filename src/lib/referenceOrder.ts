export type ReferenceMoveDirection = 'up' | 'down'

export function orderedReferenceGroup<T>(
  items: readonly T[],
  item: T,
  direction: ReferenceMoveDirection,
  groupKey: (value: T) => string,
): T[] {
  const key = groupKey(item)
  const group = items.filter((value) => groupKey(value) === key)
  const index = group.indexOf(item)
  const destination = direction === 'up' ? index - 1 : index + 1

  if (index < 0 || destination < 0 || destination >= group.length) return group

  const reordered = [...group]
  const displaced = reordered[destination]
  reordered[destination] = reordered[index]
  reordered[index] = displaced
  return reordered
}

export function canMoveReference<T>(
  items: readonly T[],
  item: T,
  direction: ReferenceMoveDirection,
  groupKey: (value: T) => string,
) {
  const group = items.filter((value) => groupKey(value) === groupKey(item))
  const index = group.indexOf(item)
  return direction === 'up' ? index > 0 : index >= 0 && index < group.length - 1
}
