export function resolveRecurringRuleRequest<Rule extends { id: string }>(
  requestId: string | null,
  rules: readonly Rule[],
  rulesReady: boolean,
  editorAvailable: boolean,
  mutable: boolean,
): Rule | null | undefined {
  if (!rulesReady || !editorAvailable || requestId === null) return undefined
  if (!mutable) return null
  return rules.find((rule) => rule.id === requestId) ?? null
}
