export function confirmDiscardIfDirty(
  dirty: boolean,
  confirmDiscard: () => boolean,
  leave: () => void,
) {
  if (dirty && !confirmDiscard()) return false
  leave()
  return true
}

export function dialogLedgerContextChanged(openingContext: string, currentContext: string) {
  return openingContext !== currentContext
}
