import { statementTransferImportInputSchema } from '../../../../lib/statementTransferImport'
import { getDatabase } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonReferenceError,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../server/http'
import { createStatementTransferImport } from '../../../../server/statementTransferImport'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = statementTransferImportInputSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '結單轉帳資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const result = await createStatementTransferImport(await getDatabase(), parsed.data)
  if (result.kind === 'reference_invalid') return jsonReferenceError('ACCOUNT_INVALID')
  if (result.kind === 'possible_duplicate') {
    return jsonError(
      409,
      'STATEMENT_TRANSFER_POSSIBLE_DUPLICATE',
      '找到相同的現有轉帳，請手動檢查',
    )
  }
  return jsonSuccess(result, result.kind === 'created' ? 201 : 200)
})

export const HEAD = apiNotFound
export const GET = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
