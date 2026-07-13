import { z } from 'zod'
import { supportedCurrencySchema } from '../../../lib/currency'
import { getDatabase } from '../../../server/db'
import {
  getLedgerCurrencySettings,
  updateLedgerCurrency,
  type LedgerCurrencyUpdateResult,
} from '../../../server/ledgerSettings'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../server/http'

export const dynamic = 'force-dynamic'

const updateSchema = z
  .object({
    currency: z.string(),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  })
  .strict()

export const GET = apiRoute(async () => jsonSuccess(
  await getLedgerCurrencySettings(await getDatabase()),
))

export const PUT = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response
  const parsed = updateSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '帳本幣別資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const currency = supportedCurrencySchema.safeParse(parsed.data.currency)
  if (!currency.success) {
    return jsonError(400, 'LEDGER_CURRENCY_UNSUPPORTED', '不支援此帳本幣別')
  }

  return updateResult(await updateLedgerCurrency(
    await getDatabase(),
    currency.data,
    parsed.data.expectedUpdatedAt,
  ))
})

export const HEAD = apiNotFound
export const POST = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound

function updateResult(result: LedgerCurrencyUpdateResult) {
  if (result.kind === 'updated') return jsonSuccess(result.settings)
  if (result.kind === 'version_conflict') {
    return jsonError(
      409,
      'LEDGER_CURRENCY_VERSION_CONFLICT',
      '帳本幣別已被修改，請重新載入後再試',
    )
  }
  return jsonError(409, 'LEDGER_CURRENCY_LOCKED', '帳本已有金額資料，無法更改幣別')
}
