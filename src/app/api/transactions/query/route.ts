import { transactionPageQuerySchema } from '../../../../lib/schema'
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
import {
  listTransactionPage,
  readLedgerRevision,
  summarizeTransactions,
  transactionPageQueryKey,
} from '../../../../server/money'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = transactionPageQuerySchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'INVALID_QUERY',
      '交易查詢參數不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const database = await getDatabase()
  const cursor = parsed.data.cursor
  if (cursor && cursor.queryKey !== transactionPageQueryKey(parsed.data)) {
    return jsonError(400, 'INVALID_CURSOR', '交易續載游標不符合目前篩選條件')
  }

  for (let attempt = 0; attempt < (cursor ? 1 : 2); attempt += 1) {
    const revision = await readLedgerRevision(database)
    if (cursor && cursor.revision !== revision) {
      return jsonError(409, 'TRANSACTION_CURSOR_STALE', '帳本已變更，請從最新交易重新載入')
    }

    const [page, summary] = await Promise.all([
      listTransactionPage(database, parsed.data, revision),
      cursor ? Promise.resolve(null) : summarizeTransactions(database, parsed.data),
    ])
    if (await readLedgerRevision(database) === revision) {
      return jsonSuccess(summary ? { ...page, summary } : page)
    }
    if (cursor) break
  }

  return jsonError(409, 'TRANSACTION_CURSOR_STALE', '帳本在載入期間已變更，請再試一次')
})

export const HEAD = apiNotFound
export const GET = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
