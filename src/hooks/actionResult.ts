import type { ActionResult } from '../server/action-result'
import { ApiError } from '../lib/api'

export async function actionData<T>(resultPromise: Promise<ActionResult<T>>): Promise<T> {
  const result = await resultPromise
  if (!result.ok) throw new ApiError(result.error.message, result.error.code, 0)
  return result.data
}
