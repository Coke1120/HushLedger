export type TransactionExportState = 'idle' | 'preparing' | 'ready' | 'error'

export function transactionActionsDisclosureActive(
  csvImportOpen: boolean,
  aiImportOpen: boolean,
  exportState: TransactionExportState,
) {
  return csvImportOpen || aiImportOpen || exportState === 'preparing'
}
