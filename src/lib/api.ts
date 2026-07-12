type ApiErrorPayload = {
  ok: false
  error: {
    code: string
    message: string
    issues?: unknown
  }
}

type ApiSuccessPayload<T> = {
  ok: true
  data: T
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
  })

  let payload: ApiSuccessPayload<T> | ApiErrorPayload | undefined
  try {
    payload = (await response.json()) as ApiSuccessPayload<T> | ApiErrorPayload
  } catch {
    payload = undefined
  }

  if (!response.ok || !payload || payload.ok === false) {
    const error = payload && payload.ok === false ? payload.error : undefined
    throw new ApiError(
      error?.message ?? 'The request could not be completed.',
      error?.code ?? 'REQUEST_FAILED',
      response.status,
    )
  }

  return payload.data
}
