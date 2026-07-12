import {
  categoryUpdateSchema,
  referenceIdSchema,
  referenceStatusSchema,
} from '../../../../lib/schema'
import { getDatabase } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonReferenceMutationResult,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../server/http'
import {
  getCategoryReference,
  setCategoryReferenceStatus,
  updateCategoryReference,
} from '../../../../server/referenceData'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = apiRoute(async (_request, context: RouteContext) => {
  const id = referenceIdSchema.safeParse((await context.params).id)
  if (!id.success) return invalidReferenceId(id.error.issues)

  const category = await getCategoryReference(await getDatabase(), id.data)
  return category
    ? jsonSuccess(category)
    : jsonError(404, 'REFERENCE_NOT_FOUND', '找不到指定的分類')
})

export const PUT = apiRoute(async (request, context: RouteContext) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded
  const id = referenceIdSchema.safeParse((await context.params).id)
  if (!id.success) return invalidReferenceId(id.error.issues)

  const body = await readApiJson(request)
  if (!body.ok) return body.response
  const parsed = categoryUpdateSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(400, 'VALIDATION_ERROR', '分類資料不正確', sanitizeValidationIssues(parsed.error.issues))
  }

  return jsonReferenceMutationResult(
    await updateCategoryReference(await getDatabase(), id.data, parsed.data),
  )
})

export const PATCH = apiRoute(async (request, context: RouteContext) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded
  const id = referenceIdSchema.safeParse((await context.params).id)
  if (!id.success) return invalidReferenceId(id.error.issues)

  const body = await readApiJson(request)
  if (!body.ok) return body.response
  const parsed = referenceStatusSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(400, 'VALIDATION_ERROR', '分類狀態不正確', sanitizeValidationIssues(parsed.error.issues))
  }

  return jsonReferenceMutationResult(
    await setCategoryReferenceStatus(await getDatabase(), id.data, parsed.data),
  )
})

export const HEAD = apiNotFound
export const POST = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound

function invalidReferenceId(issues: Parameters<typeof sanitizeValidationIssues>[0]) {
  return jsonError(400, 'INVALID_REFERENCE_ID', '分類 ID 不正確', sanitizeValidationIssues(issues))
}
