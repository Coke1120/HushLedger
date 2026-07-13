type KeyboardShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat'
>

export function isTransactionSaveShortcut(event: KeyboardShortcutEvent) {
  return event.key === 'Enter'
    && (event.ctrlKey || event.metaKey)
    && !event.altKey
    && !event.shiftKey
    && !event.repeat
}
