import { categoryCreateSchema } from '../../../lib/schema'
import { getDatabase } from '../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonReferenceMutationResult,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../server/http'
import { listCategories } from '../../../server/money'
import { createCategoryReference } from '../../../server/referenceData'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async () => jsonSuccess(await listCategories(await getDatabase())))

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response
  const parsed = categoryCreateSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '分類資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return jsonReferenceMutationResult(
    await createCategoryReference(await getDatabase(), parsed.data),
    true,
  )
})

export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
