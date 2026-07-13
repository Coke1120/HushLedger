import type { RecurringRule } from './schema'

export function resolveRecurringRuleRequest(
  requestId: string | null,
  rules: readonly RecurringRule[],
  rulesReady: boolean,
  editorAvailable: boolean,
  mutable: boolean,
): RecurringRule | null | undefined {
  if (!rulesReady || !editorAvailable || requestId === null) return undefined
  if (!mutable) return null
  return rules.find((rule) => rule.id === requestId) ?? null
}
