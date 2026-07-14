import { getDatabase } from '../../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../../server/http'
import { getAccountUnclearedReview } from '../../../../../server/accountRegister'
import { accountUnclearedReviewSchema } from '../../../../../server/validation'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = accountUnclearedReviewSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'INVALID_QUERY',
      '未清算流水帳查詢不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const review = await getAccountUnclearedReview(await getDatabase(), parsed.data)
  return review
    ? jsonSuccess(review)
    : jsonError(404, 'ACCOUNT_NOT_FOUND', '找不到帳戶')
})

export const HEAD = apiNotFound
export const GET = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
