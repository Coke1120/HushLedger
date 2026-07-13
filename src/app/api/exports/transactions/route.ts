import { transactionQuerySchema } from '../../../../lib/schema'
import { transactionsToCsv } from '../../../../lib/transactionCsv'
import { getDatabase } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  jsonError,
  queryObject,
  sanitizeValidationIssues,
} from '../../../../server/http'
import { listTransactionsForExport } from '../../../../server/money'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async (request) => {
  const parsed = transactionQuerySchema.safeParse(queryObject(request))
  if (!parsed.success) {
    return jsonError(
      400,
      'INVALID_QUERY',
      '匯出查詢參數不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const transactions = await listTransactionsForExport(await getDatabase(), parsed.data)
  return new Response(transactionsToCsv(transactions), {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="hushledger-transactions-${
        parsed.data.scope === 'all' ? 'all' : parsed.data.month
      }.csv"`,
      'Content-Type': 'text/csv; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

export const HEAD = apiNotFound
export const POST = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
