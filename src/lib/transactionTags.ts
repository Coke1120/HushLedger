const transactionTagNamePattern = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,39}$/u

export function isTransactionTagName(value: string) {
  return transactionTagNamePattern.test(value)
}

export function isTransactionTag(value: string) {
  return value.startsWith('#') && isTransactionTagName(value.slice(1))
}

export function transactionTagsFromNote(note: string) {
  const tags: string[] = []
  const seen = new Set<string>()

  for (const token of note.split(/[ \t\r\n]+/u)) {
    if (!isTransactionTag(token) || seen.has(token)) continue
    seen.add(token)
    tags.push(token)
  }

  return tags
}

export function noteHasTransactionTag(note: string, tag: string) {
  return isTransactionTag(tag) && transactionTagsFromNote(note).includes(tag)
}
