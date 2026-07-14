import { isValidCalendarDate } from './date'

export type RecurringRuleUrgency =
  | 'overdue'
  | 'due_today'
  | 'due_soon'
  | 'active'
  | 'paused'
  | 'completed'

type RecurringSchedule = {
  isActive: boolean
  nextOccurrenceOn: string
  scheduleEndsOn?: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000
const DUE_SOON_DAYS = 7
const urgencyPriority: Record<RecurringRuleUrgency, number> = {
  overdue: 0,
  due_today: 1,
  due_soon: 2,
  active: 3,
  paused: 4,
  completed: 5,
}

function calendarDayNumber(value: string) {
  if (!isValidCalendarDate(value)) throw new Error('Recurring timing requires a valid calendar date')
  return Date.parse(`${value}T00:00:00.000Z`) / DAY_MS
}

export function recurringRuleUrgency(
  rule: RecurringSchedule,
  today: string,
): RecurringRuleUrgency {
  const todayDay = calendarDayNumber(today)
  const nextDay = calendarDayNumber(rule.nextOccurrenceOn)

  if (rule.scheduleEndsOn && rule.nextOccurrenceOn > rule.scheduleEndsOn) return 'completed'
  if (!rule.isActive) return 'paused'
  if (nextDay < todayDay) return 'overdue'
  if (nextDay === todayDay) return 'due_today'
  if (nextDay - todayDay <= DUE_SOON_DAYS) return 'due_soon'
  return 'active'
}

export function orderRecurringRulesByUrgency<T extends RecurringSchedule>(
  rules: readonly T[],
  today: string,
) {
  return rules
    .map((rule, index) => ({ rule, index, urgency: recurringRuleUrgency(rule, today) }))
    .sort((left, right) =>
      urgencyPriority[left.urgency] - urgencyPriority[right.urgency]
      || left.rule.nextOccurrenceOn.localeCompare(right.rule.nextOccurrenceOn)
      || left.index - right.index,
    )
    .map(({ rule }) => rule)
}

export function countDueRecurringRules(
  rules: readonly RecurringSchedule[],
  today: string,
) {
  return rules.reduce((count, rule) => {
    const urgency = recurringRuleUrgency(rule, today)
    return count + (urgency === 'overdue' || urgency === 'due_today' ? 1 : 0)
  }, 0)
}
