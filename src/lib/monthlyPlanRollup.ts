import type { MonthlySpendingPlanSummary } from './schema'

type PlanAmount = Pick<MonthlySpendingPlanSummary, 'plannedMinor' | 'spentMinor'>

export type MonthlyPlanRollup = {
  plannedMinor: number
  spentInPlansMinor: number
  differenceMinor: number
  outsidePlansMinor: number
}

export function summarizeMonthlyPlans(
  expenseMinor: number,
  plans: readonly PlanAmount[],
): MonthlyPlanRollup | null {
  if (!isNonNegativeSafeInteger(expenseMinor)) return null
  let plannedMinor = 0
  let spentInPlansMinor = 0

  for (const plan of plans) {
    if (!isPositiveSafeInteger(plan.plannedMinor) || !isNonNegativeSafeInteger(plan.spentMinor)) {
      return null
    }
    const nextPlannedMinor = safeAdd(plannedMinor, plan.plannedMinor)
    const nextSpentInPlansMinor = safeAdd(spentInPlansMinor, plan.spentMinor)
    if (nextPlannedMinor === null || nextSpentInPlansMinor === null) return null
    plannedMinor = nextPlannedMinor
    spentInPlansMinor = nextSpentInPlansMinor
  }

  const outsidePlansMinor = safeSubtract(expenseMinor, spentInPlansMinor)
  const differenceMinor = safeSubtract(plannedMinor, spentInPlansMinor)
  if (outsidePlansMinor === null || outsidePlansMinor < 0 || differenceMinor === null) return null

  return {
    plannedMinor,
    spentInPlansMinor,
    differenceMinor,
    outsidePlansMinor,
  }
}

function safeAdd(left: number, right: number) {
  const result = left + right
  return Number.isSafeInteger(result) ? result : null
}

function safeSubtract(left: number, right: number) {
  const result = left - right
  return Number.isSafeInteger(result) ? result : null
}

function isPositiveSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0
}

function isNonNegativeSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0
}
