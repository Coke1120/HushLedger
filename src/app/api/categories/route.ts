import { getDatabase } from '../../../server/db'
import { apiNotFound, apiRoute, jsonSuccess } from '../../../server/http'
import { listCategories } from '../../../server/money'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async () => jsonSuccess(await listCategories(await getDatabase())))

export const HEAD = apiNotFound
export const POST = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
