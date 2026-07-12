import type { ZodIssue } from 'zod'
import type { ReferenceErrorCode, UpdateRuleResult } from './recurring'
import type { ReferenceMutationResult, ReferenceOrderResult } from './referenceData'

export const MAX_JSON_BODY_BYTES = 16 * 1024

type SuccessStatus = 200 | 201
type ErrorStatus = 400 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 502 | 504

export type ApiSuccessPayload<T> = { ok: true; data: T }
export type ApiErrorPayload = {
  ok: false
  error: {
    code: string
    message: string
    issues?: Array<{ path: string; message: string }>
  }
}

export class InvalidJsonError extends Error {}
export class PayloadTooLargeError extends Error {}
export class UnsupportedMediaTypeError extends Error {}

const noStoreHeaders = { 'Cache-Control': 'private, no-store' }

export function jsonSuccess<T>(data: T, status: SuccessStatus = 200) {
  const payload: ApiSuccessPayload<T> = { ok: true, data }
  return Response.json(payload, { status, headers: noStoreHeaders })
}

export function jsonError(
  status: ErrorStatus,
  code: string,
  message: string,
  issues?: Array<{ path: string; message: string }>,
) {
  const payload: ApiErrorPayload = {
    ok: false,
    error: {
      code,
      message,
      ...(issues && issues.length > 0 ? { issues } : {}),
    },
  }
  return Response.json(payload, { status, headers: noStoreHeaders })
}

export function sanitizeValidationIssues(issues: ZodIssue[]) {
  return issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.map(String).join('.') : 'request',
    message: issue.message,
  }))
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return false

  try {
    const forwardedOrigin = request.headers.get('x-hushledger-access-verified') === 'true'
      ? request.headers.get('x-hushledger-request-origin')
      : null
    const requestOrigin = new URL(forwardedOrigin ?? request.url)
    const browserOrigin = new URL(origin)
    return (
      browserOrigin.origin === requestOrigin.origin ||
      isEquivalentLoopbackOrigin(browserOrigin, requestOrigin)
    )
  } catch {
    return false
  }
}

export function contentLengthExceeds(request: Request, limit = MAX_JSON_BODY_BYTES) {
  const value = request.headers.get('content-length')
  if (!value) return false

  const length = Number(value)
  return Number.isFinite(length) && length >= 0 && length > limit
}

export function queryObject(request: Request) {
  const query: Record<string, string | string[]> = {}

  for (const [key, value] of new URL(request.url).searchParams) {
    const current = query[key]
    if (current === undefined) {
      query[key] = value
    } else {
      query[key] = Array.isArray(current) ? [...current, value] : [current, value]
    }
  }

  return query
}

export function guardMutationRequest(request: Request, limit = MAX_JSON_BODY_BYTES) {
  if (!isSameOrigin(request)) {
    return jsonError(403, 'ORIGIN_FORBIDDEN', '只接受同源寫入請求')
  }
  if (contentLengthExceeds(request, limit)) {
    return jsonError(413, 'PAYLOAD_TOO_LARGE', `請求內容不得超過 ${limit} bytes`)
  }
  return null
}

export async function readJsonBody(request: Request, limit = MAX_JSON_BODY_BYTES) {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new UnsupportedMediaTypeError()

  const reader = request.body?.getReader()
  if (!reader) throw new InvalidJsonError()

  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      throw new PayloadTooLargeError()
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
    return JSON.parse(text) as unknown
  } catch {
    throw new InvalidJsonError()
  }
}

export async function readApiJson(request: Request, limit = MAX_JSON_BODY_BYTES) {
  try {
    return { ok: true as const, data: await readJsonBody(request, limit) }
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return {
        ok: false as const,
        response: jsonError(
          413,
          'PAYLOAD_TOO_LARGE',
          `請求內容不得超過 ${limit} bytes`,
        ),
      }
    }
    if (error instanceof UnsupportedMediaTypeError) {
      return {
        ok: false as const,
        response: jsonError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必須是 application/json'),
      }
    }
    if (error instanceof InvalidJsonError) {
      return {
        ok: false as const,
        response: jsonError(400, 'INVALID_JSON', '請求內容不是有效 JSON'),
      }
    }
    throw error
  }
}

export function isLocalDevelopmentRequest(request: Request) {
  const hostname = new URL(request.url).hostname
  return isLoopbackHostname(hostname)
}

export function isAuthenticatedApiRequest(request: Request) {
  return (
    request.headers.get('x-hushledger-access-verified') === 'true' ||
    isLocalDevelopmentRequest(request)
  )
}

function isEquivalentLoopbackOrigin(left: URL, right: URL) {
  return (
    left.protocol === right.protocol &&
    left.port === right.port &&
    isLoopbackHostname(left.hostname) &&
    isLoopbackHostname(right.hostname)
  )
}

function isLoopbackHostname(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  )
}

export function jsonReferenceError(code: ReferenceErrorCode) {
  if (code === 'ACCOUNT_INVALID') {
    return jsonError(400, code, '帳戶不存在、已停用或幣別不相符')
  }
  if (code === 'CATEGORY_INVALID') {
    return jsonError(400, code, '分類不存在或已停用')
  }
  return jsonError(400, code, '分類與交易類型不相符')
}

export function jsonRecurringMutationResult(result: UpdateRuleResult) {
  if (result.kind === 'not_found') {
    return jsonError(404, 'RULE_NOT_FOUND', '找不到指定的週期交易')
  }
  if (result.kind === 'version_conflict') {
    return jsonError(409, 'RULE_VERSION_CONFLICT', '週期交易已被修改，請重新載入後再試')
  }
  if (result.kind === 'reference_invalid') return jsonReferenceError(result.code)
  return jsonSuccess(result.rule)
}

export function jsonReferenceMutationResult<T>(result: ReferenceMutationResult<T>, created = false) {
  if (result.kind === 'created' || result.kind === 'updated') {
    return jsonSuccess(result.item, created ? 201 : 200)
  }
  if (result.kind === 'not_found') {
    return jsonError(404, 'REFERENCE_NOT_FOUND', '找不到指定的帳戶或分類')
  }
  if (result.kind === 'version_conflict') {
    return jsonError(409, 'REFERENCE_VERSION_CONFLICT', '帳戶或分類已被修改，請重新載入後再試')
  }
  if (result.kind === 'name_conflict') {
    return jsonError(409, 'REFERENCE_NAME_CONFLICT', '同類型已有相同名稱')
  }
  if (result.kind === 'last_active') {
    return jsonError(409, 'REFERENCE_LAST_ACTIVE', '必須保留至少一個可用項目')
  }
  if (result.kind === 'active_rules') {
    return jsonError(409, 'REFERENCE_ACTIVE_RULES', '請先暫停或修改使用此項目的週期交易')
  }
  return jsonError(500, 'INTERNAL_ERROR', '伺服器暫時無法處理請求')
}

export function jsonReferenceOrderResult<T>(result: ReferenceOrderResult<T>) {
  return result.kind === 'updated'
    ? jsonSuccess(result.items)
    : jsonError(409, 'REFERENCE_VERSION_CONFLICT', '帳戶或分類已被修改，請重新載入後再試')
}

export function apiRoute<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>,
) {
  return async (request: Request, ...args: Args) => {
    try {
      return await handler(request, ...args)
    } catch {
      console.error('request_failed', { method: request.method })
      return jsonError(500, 'INTERNAL_ERROR', '伺服器暫時無法處理請求')
    }
  }
}

export const apiNotFound = apiRoute(async (request) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    const guarded = guardMutationRequest(request)
    if (guarded) return guarded
  }
  return jsonError(404, 'NOT_FOUND', '找不到指定的 API')
})
