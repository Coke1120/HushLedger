export type TransactionExportState = 'idle' | 'preparing' | 'ready' | 'error'

export function transactionActionsDisclosureActive(
  csvImportOpen: boolean,
  aiCopilotOpen: boolean,
  exportState: TransactionExportState,
) {
  return csvImportOpen || aiCopilotOpen || exportState === 'preparing'
}
