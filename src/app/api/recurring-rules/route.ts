import { recurringRuleCreateSchema } from '../../../lib/schema'
import { getDatabase } from '../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonReferenceError,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../server/http'
import { createRecurringRule, listRecurringRules } from '../../../server/recurring'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async () =>
  jsonSuccess(await listRecurringRules(await getDatabase())),
)

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = recurringRuleCreateSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '週期交易資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const result = await createRecurringRule(await getDatabase(), parsed.data)
  if (result.kind === 'id_conflict') {
    return jsonError(409, 'ID_CONFLICT', '週期交易 ID 已用於另一筆資料')
  }
  if (result.kind === 'reference_invalid') return jsonReferenceError(result.code)
  return jsonSuccess(result.rule, result.kind === 'created' ? 201 : 200)
})

export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
