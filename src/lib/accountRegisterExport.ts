export function accountRegisterExportCanStart({
  canExport,
  rangeReady,
  rangeChanged,
  saving,
}: {
  canExport: boolean
  rangeReady: boolean
  rangeChanged: boolean
  saving: boolean
}) {
  return canExport && rangeReady && !rangeChanged && !saving
}

export function accountRegisterExportIsCurrent({
  requestId,
  activeRequestId,
  requestContext,
  activeContext,
  aborted,
}: {
  requestId: number
  activeRequestId: number
  requestContext: string
  activeContext: string
  aborted: boolean
}) {
  return !aborted
    && requestId === activeRequestId
    && requestContext === activeContext
}
