import {
  MAX_CSV_IMPORT_REQUEST_BYTES,
  csvImportRequestSchema,
} from '../../../../lib/csvImport'
import { commitCsvImport, previewCsvImport } from '../../../../server/csvImport'
import { getDatabase } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../server/http'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request, MAX_CSV_IMPORT_REQUEST_BYTES)
  if (guarded) return guarded

  const body = await readApiJson(request, MAX_CSV_IMPORT_REQUEST_BYTES)
  if (!body.ok) return body.response

  const parsed = csvImportRequestSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      'CSV 匯入資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const database = await getDatabase()
  if (parsed.data.mode === 'preview') {
    return jsonSuccess(await previewCsvImport(database, parsed.data.rows))
  }

  try {
    const outcome = await commitCsvImport(database, parsed.data.rows)
    if (outcome.kind === 'blocked') {
      return jsonError(409, 'CSV_IMPORT_BLOCKED', '部分匯入資料已失效，請重新預覽')
    }
    return jsonSuccess(outcome.result, outcome.result.imported > 0 ? 201 : 200)
  } catch (error) {
    if (isImportKeyConflict(error)) {
      return jsonError(409, 'CSV_IMPORT_STALE', '匯入狀態已改變，請重新預覽')
    }
    throw error
  }
})

function isImportKeyConflict(error: unknown) {
  return error instanceof Error && /transaction_import_keys|UNIQUE constraint/i.test(error.message)
}

export const GET = apiNotFound
export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
