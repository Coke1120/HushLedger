import { transactionQuerySchema } from '../../../../lib/schema'
import { transactionsToCsv } from '../../../../lib/transactionCsv'
import { getDatabase } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  queryObject,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../server/http'
import { listTransactionsForExport } from '../../../../server/money'

export const dynamic = 'force-dynamic'

async function exportTransactions(input: unknown) {
  const parsed = transactionQuerySchema.safeParse(input)
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
        parsed.data.scope === 'all'
          ? 'all'
          : parsed.data.scope === 'range'
            ? `${parsed.data.dateFrom}-to-${parsed.data.dateTo}`
            : parsed.data.month
      }.csv"`,
      'Content-Type': 'text/csv; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export const GET = apiRoute(async (request) => exportTransactions(queryObject(request)))

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response
  return exportTransactions(body.data)
})

export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
