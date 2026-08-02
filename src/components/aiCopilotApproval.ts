export type AiCopilotProviderIdentity = {
  source: 'transient' | 'stored' | 'unavailable'
  baseUrl: string
  model: string
  version: string
}

export function aiCopilotApprovalKey(
  month: string,
  provider: AiCopilotProviderIdentity,
  contextDigest: string,
) {
  return [
    month,
    provider.source,
    provider.baseUrl,
    provider.model,
    provider.version,
    contextDigest,
  ].join('\n')
}
