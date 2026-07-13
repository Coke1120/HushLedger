import type { AccountRegisterEntry } from './schema'

function safeInteger(value: number, message: string) {
  if (!Number.isSafeInteger(value)) throw new Error(message)
  return value
}

export function visibleAccountRegisterEntries(
  entries: readonly AccountRegisterEntry[],
  unclearedOnly: boolean,
) {
  return unclearedOnly ? entries.filter(({ cleared }) => cleared === false) : entries
}

function safeAdd(left: number, right: number) {
  return safeInteger(left + right, 'Account register balance exceeds the safe integer range')
}

export function calculateAccountRegisterBalances(
  calculationStartMinor: number,
  totalActivityMinor: number,
  newestAmountsMinor: readonly number[],
) {
  safeInteger(calculationStartMinor, 'Account register starting balance is not a safe integer')
  safeInteger(totalActivityMinor, 'Account register activity total is not a safe integer')
  newestAmountsMinor.forEach((amount) => {
    safeInteger(amount, 'Account register entry amount is not a safe integer')
  })

  const returnedActivityMinor = newestAmountsMinor.reduce(safeAdd, 0)
  const omittedActivityMinor = safeAdd(totalActivityMinor, -returnedActivityMinor)
  let running = safeAdd(calculationStartMinor, omittedActivityMinor)
  const runningOldestFirst = [...newestAmountsMinor]
    .reverse()
    .map((amount) => {
      running = safeAdd(running, amount)
      return running
    })

  return {
    endingBalanceMinor: safeAdd(calculationStartMinor, totalActivityMinor),
    runningNewestFirst: runningOldestFirst.reverse(),
  }
}
