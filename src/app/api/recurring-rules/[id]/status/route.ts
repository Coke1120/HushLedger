import { recurringRuleStatusSchema } from '../../../../../lib/schema'
import { getDatabase } from '../../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonRecurringMutationResult,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../../server/http'
import { setRecurringRuleStatus } from '../../../../../server/recurring'
import { recurringRuleIdSchema } from '../../../../../server/validation'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = apiRoute(async (request, context: RouteContext) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const id = recurringRuleIdSchema.safeParse((await context.params).id)
  if (!id.success) {
    return jsonError(
      400,
      'INVALID_RULE_ID',
      '週期交易 ID 不正確',
      sanitizeValidationIssues(id.error.issues),
    )
  }

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = recurringRuleStatusSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '週期交易狀態不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return jsonRecurringMutationResult(
    await setRecurringRuleStatus(await getDatabase(), id.data, parsed.data),
  )
})

export const GET = apiNotFound
export const HEAD = apiNotFound
export const POST = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
