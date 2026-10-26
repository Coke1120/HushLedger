export type CompositionItem = {
  key: string
  name: string
  amountMinor: number
  color: string
}

export type Composition = {
  state: 'ready' | 'empty' | 'unavailable'
  total: number
  segments: Array<CompositionItem & { share: number; offset: number }>
}

/** Only positive parts of one exact total form a pie. Signed trends stay charts. */
export function categoryComposition(items: readonly CompositionItem[], total: number): Composition {
  const unavailable: Composition = { state: 'unavailable', total: 0, segments: [] }
  if (!Number.isSafeInteger(total) || total < 0
    || items.some(({ amountMinor }) => !Number.isSafeInteger(amountMinor) || amountMinor < 0)) return unavailable
  const sum = items.reduce((value, item) => value + BigInt(item.amountMinor), 0n)
  if (sum !== BigInt(total)) return unavailable
  if (total === 0) return { state: 'empty', total: 0, segments: [] }
  let offset = 0
  return {
    state: 'ready',
    total,
    segments: items.filter(({ amountMinor }) => amountMinor > 0).map((item) => {
      const share = item.amountMinor / total * 100
      const segment = { ...item, share, offset }
      offset += share
      return segment
    }),
  }
}
