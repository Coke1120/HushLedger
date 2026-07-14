import { accountRegisterToCsv } from '../../../../lib/accountRegisterCsv'
import { getAccountRegisterForExport } from '../../../../server/accountRegister'
import { getDatabase } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../server/http'
import { getLedgerCurrencySettings } from '../../../../server/ledgerSettings'
import { accountRegisterQuerySchema } from '../../../../server/validation'

export const dynamic = 'force-dynamic'

async function exportAccountRegister(input: unknown) {
  const parsed = accountRegisterQuerySchema.safeParse(input)
  if (!parsed.success) {
    return jsonError(
      400,
      'INVALID_QUERY',
      '帳戶流水帳匯出查詢不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const database = await getDatabase()
  const register = await getAccountRegisterForExport(database, parsed.data)
  if (!register) return jsonError(404, 'ACCOUNT_NOT_FOUND', '找不到帳戶')
  const { currency } = await getLedgerCurrencySettings(database)

  return new Response(accountRegisterToCsv(register, currency), {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="hushledger-account-register-${
        register.accountId
      }-${register.dateFrom}-to-${register.dateTo}.csv"`,
      'Content-Type': 'text/csv; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export const GET = apiNotFound

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response
  return exportAccountRegister(body.data)
})

export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
