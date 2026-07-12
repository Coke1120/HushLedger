import { getDatabase } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  isLocalDevelopmentRequest,
  jsonError,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../server/http'
import { hktCalendarDate, runDueRecurringRules } from '../../../../server/recurring'
import { recurringRunDueSchema } from '../../../../server/validation'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = recurringRunDueSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '週期交易執行資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }
  if (parsed.data.asOf && !isLocalDevelopmentRequest(request)) {
    return jsonError(403, 'AS_OF_FORBIDDEN', '只可在本機開發環境指定執行日期')
  }

  const asOf = parsed.data.asOf ?? hktCalendarDate()
  return jsonSuccess(await runDueRecurringRules(await getDatabase(), asOf))
})

export const GET = apiNotFound
export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
