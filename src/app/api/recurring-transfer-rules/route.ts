import { recurringTransferRuleCreateSchema } from '../../../lib/schema'
import { getDatabase } from '../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../server/http'
import {
  createRecurringTransferRule,
  listRecurringTransferRules,
} from '../../../server/recurringTransfers'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async () =>
  jsonSuccess(await listRecurringTransferRules(await getDatabase())),
)

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = recurringTransferRuleCreateSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '週期轉帳資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const result = await createRecurringTransferRule(await getDatabase(), parsed.data)
  if (result.kind === 'id_conflict') {
    return jsonError(409, 'ID_CONFLICT', '週期轉帳 ID 已用於另一筆資料')
  }
  if (result.kind === 'reference_invalid') {
    return jsonError(400, result.code, '帳戶不存在、已停用或幣別不相符')
  }
  return jsonSuccess(result.rule, result.kind === 'created' ? 201 : 200)
})

export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
