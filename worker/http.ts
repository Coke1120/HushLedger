import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ZodIssue } from 'zod'

export const MAX_JSON_BODY_BYTES = 16 * 1024

type WorkerContext = Context<{ Bindings: Env }>
type ErrorStatus = Extract<ContentfulStatusCode, 400 | 403 | 404 | 409 | 413 | 415 | 500>

export class InvalidJsonError extends Error {}
export class PayloadTooLargeError extends Error {}
export class UnsupportedMediaTypeError extends Error {}

export function jsonSuccess(c: WorkerContext, data: unknown, status: ContentfulStatusCode = 200) {
  return c.json({ ok: true as const, data }, status)
}

export function jsonError(
  c: WorkerContext,
  status: ErrorStatus,
  code: string,
  message: string,
  issues?: Array<{ path: string; message: string }>,
) {
  return c.json(
    {
      ok: false as const,
      error: {
        code,
        message,
        ...(issues && issues.length > 0 ? { issues } : {}),
      },
    },
    status,
  )
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
    return new URL(origin).origin === new URL(request.url).origin
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
