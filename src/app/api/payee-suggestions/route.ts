import { getDatabase } from '../../../server/db'
import { apiNotFound, apiRoute, jsonSuccess } from '../../../server/http'
import { listPayeeSuggestions } from '../../../server/money'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async (request) => jsonSuccess(
  await listPayeeSuggestions(await getDatabase(), Number(new URL(request.url).searchParams.get('accountId'))),
))

export const HEAD = apiNotFound
export const POST = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
