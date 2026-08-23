export type TransactionExportState = 'idle' | 'preparing' | 'ready' | 'error'

export function transactionActionsDisclosureActive(
  csvImportOpen: boolean,
  aiStatementImportOpen: boolean,
  aiCopilotOpen: boolean,
  exportState: TransactionExportState,
) {
  return csvImportOpen || aiStatementImportOpen || aiCopilotOpen || exportState === 'preparing'
}
