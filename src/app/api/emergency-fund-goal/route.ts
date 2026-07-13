import {
  emergencyFundGoalDeleteSchema,
  emergencyFundGoalSaveSchema,
} from '../../../lib/schema'
import { getDatabase } from '../../../server/db'
import {
  deleteEmergencyFundGoal,
  getEmergencyFundGoal,
  saveEmergencyFundGoal,
  type EmergencyFundGoalDeleteResult,
  type EmergencyFundGoalSaveResult,
} from '../../../server/emergencyFund'
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

export const GET = apiRoute(async () => jsonSuccess(
  await getEmergencyFundGoal(await getDatabase()),
))

export const PUT = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response
  const parsed = emergencyFundGoalSaveSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '緊急備用金目標資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return saveResult(await saveEmergencyFundGoal(await getDatabase(), parsed.data))
})

export const DELETE = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response
  const parsed = emergencyFundGoalDeleteSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '緊急備用金目標版本不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return deleteResult(await deleteEmergencyFundGoal(await getDatabase(), parsed.data))
})

export const HEAD = apiNotFound
export const POST = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound

function saveResult(result: EmergencyFundGoalSaveResult) {
  if (result.kind === 'created') return jsonSuccess(result.goal, 201)
  if (result.kind === 'updated') return jsonSuccess(result.goal)
  if (result.kind === 'not_found') {
    return jsonError(404, 'EMERGENCY_FUND_GOAL_NOT_FOUND', '找不到緊急備用金目標')
  }
  if (result.kind === 'version_conflict') {
    return jsonError(409, 'EMERGENCY_FUND_GOAL_VERSION_CONFLICT', '緊急備用金目標已被修改，請重新載入後再試')
  }
  return jsonError(400, 'EMERGENCY_FUND_ACCOUNT_INVALID', '請選擇有效且非信用卡的帳戶')
}

function deleteResult(result: EmergencyFundGoalDeleteResult) {
  if (result.kind === 'deleted') return jsonSuccess({ deleted: true })
  if (result.kind === 'not_found') {
    return jsonError(404, 'EMERGENCY_FUND_GOAL_NOT_FOUND', '找不到緊急備用金目標')
  }
  return jsonError(409, 'EMERGENCY_FUND_GOAL_VERSION_CONFLICT', '緊急備用金目標已被修改，請重新載入後再試')
}
