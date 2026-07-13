import { recurringRuleSkipSchema } from '../../../../../lib/schema'
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
import { skipRecurringRuleOccurrence } from '../../../../../server/recurring'
import { recurringRuleIdSchema } from '../../../../../server/validation'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = apiRoute(async (request, context: RouteContext) => {
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

  const parsed = recurringRuleSkipSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '略過週期交易資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return jsonRecurringMutationResult(
    await skipRecurringRuleOccurrence(await getDatabase(), id.data, parsed.data),
  )
})

export const GET = apiNotFound
export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
