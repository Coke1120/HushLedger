import { accountCreateSchema, referenceOrderSchema } from '../../../lib/schema'
import { getDatabase } from '../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonReferenceMutationResult,
  jsonReferenceOrderResult,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../server/http'
import { listAccounts } from '../../../server/money'
import { createAccountReference, reorderAccountReferences } from '../../../server/referenceData'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async () => jsonSuccess(await listAccounts(await getDatabase())))

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response
  const parsed = accountCreateSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '帳戶資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return jsonReferenceMutationResult(
    await createAccountReference(await getDatabase(), parsed.data),
    true,
  )
})

export const PATCH = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response
  const parsed = referenceOrderSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '帳戶排序資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return jsonReferenceOrderResult(
    await reorderAccountReferences(await getDatabase(), parsed.data),
  )
})

export const HEAD = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
