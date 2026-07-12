import { recurringRuleDeleteSchema, recurringRuleUpdateSchema } from '../../../../lib/schema'
import { getDatabase } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonRecurringMutationResult,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../server/http'
import {
  deleteRecurringRule,
  getRecurringRule,
  updateRecurringRule,
} from '../../../../server/recurring'
import { recurringRuleIdSchema } from '../../../../server/validation'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = apiRoute(async (_request, context: RouteContext) => {
  const id = recurringRuleIdSchema.safeParse((await context.params).id)
  if (!id.success) return invalidRuleId(id.error.issues)

  const rule = await getRecurringRule(await getDatabase(), id.data)
  return rule
    ? jsonSuccess(rule)
    : jsonError(404, 'RULE_NOT_FOUND', '找不到指定的週期交易')
})

export const PUT = apiRoute(async (request, context: RouteContext) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const id = recurringRuleIdSchema.safeParse((await context.params).id)
  if (!id.success) return invalidRuleId(id.error.issues)

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = recurringRuleUpdateSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '週期交易資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return jsonRecurringMutationResult(
    await updateRecurringRule(await getDatabase(), id.data, parsed.data),
  )
})

export const DELETE = apiRoute(async (request, context: RouteContext) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const id = recurringRuleIdSchema.safeParse((await context.params).id)
  if (!id.success) return invalidRuleId(id.error.issues)

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = recurringRuleDeleteSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '刪除週期交易資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const result = await deleteRecurringRule(await getDatabase(), id.data, parsed.data.revision)
  if (result.kind === 'not_found') {
    return jsonError(404, 'RULE_NOT_FOUND', '找不到指定的週期交易')
  }
  if (result.kind === 'version_conflict') {
    return jsonError(409, 'RULE_VERSION_CONFLICT', '週期交易已被修改，請重新載入後再試')
  }
  return jsonSuccess({ id: result.id, deleted: true, revision: result.revision })
})

export const HEAD = apiNotFound
export const POST = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound

function invalidRuleId(issues: Parameters<typeof sanitizeValidationIssues>[0]) {
  return jsonError(
    400,
    'INVALID_RULE_ID',
    '週期交易 ID 不正確',
    sanitizeValidationIssues(issues),
  )
}
