import {
  ECB_REFERENCE_RATE_BASE_CURRENCY,
  ECB_REFERENCE_RATE_SOURCE,
} from '../../../../lib/ecbReferenceRates'
import { getDatabase } from '../../../../server/db'
import {
  EcbReferenceRateUnavailableError,
  fetchEcbReferenceRates,
  listLatestEcbReferenceRates,
  saveEcbReferenceRates,
} from '../../../../server/ecbReferenceRates'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonSuccess,
} from '../../../../server/http'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async () => jsonSuccess({
  source: ECB_REFERENCE_RATE_SOURCE,
  baseCurrency: ECB_REFERENCE_RATE_BASE_CURRENCY,
  rates: await listLatestEcbReferenceRates(await getDatabase()),
}))

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  try {
    const rates = await fetchEcbReferenceRates()
    return jsonSuccess({
      source: ECB_REFERENCE_RATE_SOURCE,
      baseCurrency: ECB_REFERENCE_RATE_BASE_CURRENCY,
      rates: await saveEcbReferenceRates(await getDatabase(), rates),
    })
  } catch (error) {
    if (error instanceof EcbReferenceRateUnavailableError) {
      return jsonError(502, 'ECB_REFERENCE_RATES_UNAVAILABLE', '目前無法取得 ECB 參考匯率')
    }
    throw error
  }
})

export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
