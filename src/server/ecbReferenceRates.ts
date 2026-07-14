import 'server-only'

import {
  ECB_REFERENCE_RATE_BASE_CURRENCY,
  ECB_REFERENCE_RATE_SOURCE,
  parseEcbReferenceRatesCsv,
  type EcbReferenceRate,
} from '../lib/ecbReferenceRates'
import type { SupportedCurrency } from '../lib/currency'

const ECB_REFERENCE_RATE_URL = 'https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?lastNObservations=1&format=csvdata'
const MAX_ECB_RESPONSE_BYTES = 256 * 1024
const ECB_REQUEST_TIMEOUT_MS = 12_000

export type StoredEcbReferenceRate = EcbReferenceRate & {
  fetchedAt: string
}

type EcbRateRow = {
  quoteCurrency: SupportedCurrency
  rate: string
  observedOn: string
  fetchedAt: string
}

export class EcbReferenceRateUnavailableError extends Error {}

export async function fetchEcbReferenceRates(
  fetcher: typeof fetch = fetch,
): Promise<EcbReferenceRate[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ECB_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetcher(ECB_REFERENCE_RATE_URL, {
      headers: { Accept: 'text/csv' },
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) throw new EcbReferenceRateUnavailableError()
    const declaredLength = response.headers.get('content-length')
    if (declaredLength && Number(declaredLength) > MAX_ECB_RESPONSE_BYTES) {
      throw new EcbReferenceRateUnavailableError()
    }
    return parseEcbReferenceRatesCsv(await readBoundedText(response))
  } catch (error) {
    if (error instanceof EcbReferenceRateUnavailableError) throw error
    throw new EcbReferenceRateUnavailableError()
  } finally {
    clearTimeout(timeout)
  }
}

export async function saveEcbReferenceRates(
  database: D1Database,
  rates: readonly EcbReferenceRate[],
  fetchedAt = new Date().toISOString(),
) {
  if (rates.length === 0) throw new Error('Cannot save an empty ECB reference-rate snapshot')
  await database.batch(rates.map((rate) => database.prepare(`
    INSERT INTO ecb_reference_rates(
      source, base_currency, quote_currency, observed_on, rate, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, quote_currency, observed_on) DO NOTHING
  `).bind(
    ECB_REFERENCE_RATE_SOURCE,
    ECB_REFERENCE_RATE_BASE_CURRENCY,
    rate.quoteCurrency,
    rate.observedOn,
    rate.rate,
    fetchedAt,
  )))
  return listLatestEcbReferenceRates(database)
}

export async function listLatestEcbReferenceRates(
  database: D1Database,
): Promise<StoredEcbReferenceRate[]> {
  const result = await database.prepare(`
    WITH latest AS (
      SELECT quote_currency, MAX(observed_on) AS observed_on
      FROM ecb_reference_rates
      WHERE source = ? AND base_currency = ?
      GROUP BY quote_currency
    )
    SELECT
      rates.quote_currency AS quoteCurrency,
      rates.rate,
      rates.observed_on AS observedOn,
      rates.fetched_at AS fetchedAt
    FROM ecb_reference_rates AS rates
    INNER JOIN latest
      ON latest.quote_currency = rates.quote_currency
      AND latest.observed_on = rates.observed_on
    WHERE rates.source = ? AND rates.base_currency = ?
    ORDER BY rates.quote_currency ASC
  `).bind(
    ECB_REFERENCE_RATE_SOURCE,
    ECB_REFERENCE_RATE_BASE_CURRENCY,
    ECB_REFERENCE_RATE_SOURCE,
    ECB_REFERENCE_RATE_BASE_CURRENCY,
  ).all<EcbRateRow>()
  return result.results.map((rate) => ({ ...rate }))
}

async function readBoundedText(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) throw new EcbReferenceRateUnavailableError()

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_ECB_RESPONSE_BYTES) {
        await reader.cancel()
        throw new EcbReferenceRateUnavailableError()
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch (error) {
    if (error instanceof EcbReferenceRateUnavailableError) throw error
    throw new EcbReferenceRateUnavailableError()
  }
}
