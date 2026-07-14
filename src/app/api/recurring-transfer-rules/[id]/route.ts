import {
  recurringTransferRuleDeleteSchema,
  recurringTransferRuleIdSchema,
  recurringTransferRuleUpdateSchema,
} from '../../../../lib/schema'
import { getDatabase } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonRecurringTransferMutationResult,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../server/http'
import {
  deleteRecurringTransferRule,
  getRecurringTransferRule,
  updateRecurringTransferRule,
} from '../../../../server/recurringTransfers'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = apiRoute(async (_request, context: RouteContext) => {
  const id = recurringTransferRuleIdSchema.safeParse((await context.params).id)
  if (!id.success) return invalidRuleId(id.error.issues)

  const rule = await getRecurringTransferRule(await getDatabase(), id.data)
  return rule
    ? jsonSuccess(rule)
    : jsonError(404, 'RECURRING_TRANSFER_RULE_NOT_FOUND', '找不到指定的週期轉帳')
})

export const PUT = apiRoute(async (request, context: RouteContext) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const id = recurringTransferRuleIdSchema.safeParse((await context.params).id)
  if (!id.success) return invalidRuleId(id.error.issues)

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = recurringTransferRuleUpdateSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '週期轉帳資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return jsonRecurringTransferMutationResult(
    await updateRecurringTransferRule(await getDatabase(), id.data, parsed.data),
  )
})

export const DELETE = apiRoute(async (request, context: RouteContext) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const id = recurringTransferRuleIdSchema.safeParse((await context.params).id)
  if (!id.success) return invalidRuleId(id.error.issues)

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = recurringTransferRuleDeleteSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '刪除週期轉帳資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const result = await deleteRecurringTransferRule(await getDatabase(), id.data, parsed.data.revision)
  if (result.kind === 'not_found') {
    return jsonError(404, 'RECURRING_TRANSFER_RULE_NOT_FOUND', '找不到指定的週期轉帳')
  }
  if (result.kind === 'version_conflict') {
    return jsonError(
      409,
      'RECURRING_TRANSFER_RULE_VERSION_CONFLICT',
      '週期轉帳已被修改，請重新載入後再試',
    )
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
    '週期轉帳 ID 不正確',
    sanitizeValidationIssues(issues),
  )
}
