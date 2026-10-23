import { pasteRequestSchema } from '../../../../lib/pasteApproval'
import { getDatabase } from '../../../../server/db'
import { apiNotFound, apiRoute, guardMutationRequest, jsonError, jsonSuccess, readApiJson } from '../../../../server/http'
import { approvePaste, PasteConflict, previewPaste, undoPaste } from '../../../../server/pasteApproval'

export const dynamic = 'force-dynamic'
export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request, 524_288)
  if (guarded) return guarded
  const body = await readApiJson(request, 524_288)
  if (!body.ok) return body.response
  const parsed = pasteRequestSchema.safeParse(body.data)
  if (!parsed.success) return jsonError(400, 'VALIDATION_ERROR', 'Invalid approval request')
  const database = await getDatabase()
  try {
    const input = parsed.data
    if (input.mode === 'preview') return jsonSuccess(await previewPaste(database, input.rows))
    if (input.mode === 'undo') return jsonSuccess(await undoPaste(database, input.operationId))
    return jsonSuccess(await approvePaste(database, input.operationId, input.expectedRevision, input.rows))
  } catch (error) {
    if (error instanceof PasteConflict) return jsonError(409, 'PASTE_CONFLICT', 'Review the changed ledger before approving or undoing')
    throw error
  }
})
export const GET = apiNotFound
export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
