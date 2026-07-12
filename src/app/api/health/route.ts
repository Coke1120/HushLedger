import { getDatabase } from '../../../server/db'
import { apiNotFound, apiRoute, jsonSuccess } from '../../../server/http'
import { checkHealth } from '../../../server/money'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async () => {
  await checkHealth(await getDatabase())
  return jsonSuccess({ status: 'healthy' })
})

export const HEAD = apiNotFound
export const POST = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
