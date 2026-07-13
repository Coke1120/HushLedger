import { transactionQuerySchema } from '../../../../lib/schema'
import { getDatabase } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../server/http'
import { listTransactions, summarizeTransactions } from '../../../../server/money'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = transactionQuerySchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'INVALID_QUERY',
      '交易查詢參數不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const database = await getDatabase()
  const [transactions, summary] = await Promise.all([
    listTransactions(database, parsed.data),
    summarizeTransactions(database, parsed.data),
  ])
  return jsonSuccess({ transactions, summary })
})

export const HEAD = apiNotFound
export const GET = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
