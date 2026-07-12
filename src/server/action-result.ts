export type ValidationIssue = {
  path: string
  message: string
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      error: {
        code: string
        message: string
        issues?: ValidationIssue[]
      }
    }

export function actionSuccess<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}

export function actionError<T = never>(
  code: string,
  message: string,
  issues?: ValidationIssue[],
): ActionResult<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(issues && issues.length > 0 ? { issues } : {}),
    },
  }
}
