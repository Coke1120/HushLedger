import { Hono, type Context } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { z } from 'zod'
import { isValidCalendarDate, monthRangeDates } from '../src/lib/date'
import {
  type AccountLocalizationKey,
  type CategoryLocalizationKey,
  recurringRuleCreateSchema,
  recurringRuleDeleteSchema,
  recurringRuleStatusSchema,
  recurringRuleUpdateSchema,
  transactionInputSchema,
  transactionQuerySchema,
  type TransactionInput,
} from '../src/lib/schema'
import {
  contentLengthExceeds,
  InvalidJsonError,
  isSameOrigin,
  jsonError,
  jsonSuccess,
  MAX_JSON_BODY_BYTES,
  PayloadTooLargeError,
  queryObject,
  readJsonBody,
  sanitizeValidationIssues,
  UnsupportedMediaTypeError,
} from './http'
import {
  createRecurringRule,
  deleteRecurringRule,
  getRecurringRule,
  hktCalendarDate,
  listRecurringRules,
  runDueRecurringRules,
  setRecurringRuleStatus,
  updateRecurringRule,
  type ReferenceErrorCode,
  type UpdateRuleResult,
} from './recurring'

type AppEnv = { Bindings: Env }
type AppContext = Context<AppEnv>

type AccountRow = {
  id: number
  name: string
  type: 'cash' | 'bank' | 'credit_card' | 'wallet'
  currency: 'HKD'
  isActive: number
  sortOrder: number
  localizationKey: AccountLocalizationKey | null
}

type CategoryRow = {
  id: number
  name: string
  type: 'expense' | 'income'
  icon: string
  color: string
  isActive: number
  sortOrder: number
  localizationKey: CategoryLocalizationKey | null
}

type TransactionRow = {
  id: string
  type: 'expense' | 'income'
  amountMinor: number
  currency: 'HKD'
  accountId: number
  categoryId: number
  occurredOn: string
  payee: string
  note: string
  accountName: string
  accountLocalizationKey: AccountLocalizationKey | null
  categoryName: string
  categoryLocalizationKey: CategoryLocalizationKey | null
  categoryIcon: string
  categoryColor: string
  recurringRuleId: string | null
  recurringRuleName: string | null
  recurrenceDueOn: string | null
  createdAt: string
  updatedAt: string
}

type SummaryRow = {
  income: number
  expense: number
}

type ReferenceRow = {
  id: number
  isActive: number
  currency?: string
  type?: string
}

const summaryQuerySchema = transactionQuerySchema.pick({ month: true }).strict()
const recurringRuleIdSchema = z.string().uuid('週期交易 ID 必須是 UUID')
const recurringRunDueSchema = z
  .object({
    asOf: z.string().refine(isValidCalendarDate, '執行日期必須是有效的 YYYY-MM-DD 日期').optional(),
  })
  .strict()

const transactionSelect = `
  SELECT
    t.id,
    t.type,
    t.amount_minor AS amountMinor,
    t.currency,
    t.account_id AS accountId,
    t.category_id AS categoryId,
    t.occurred_on AS occurredOn,
    t.payee,
    t.note,
    a.name AS accountName,
    a.localization_key AS accountLocalizationKey,
    category.name AS categoryName,
    category.localization_key AS categoryLocalizationKey,
    category.icon AS categoryIcon,
    category.color AS categoryColor,
    t.recurring_rule_id AS recurringRuleId,
    t.recurring_rule_name AS recurringRuleName,
    t.recurrence_due_on AS recurrenceDueOn,
    t.created_at AS createdAt,
    t.updated_at AS updatedAt
  FROM transactions t
  INNER JOIN accounts a ON a.id = t.account_id
  INNER JOIN categories category ON category.id = t.category_id
`

const app = new Hono<AppEnv>()

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      workerSrc: ["'self'"],
      upgradeInsecureRequests: [],
    },
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginResourcePolicy: 'same-origin',
    permissionsPolicy: {
      camera: false,
      geolocation: false,
      microphone: false,
      payment: false,
      usb: false,
    },
    referrerPolicy: 'no-referrer',
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
    xFrameOptions: 'DENY',
  }),
)

app.use('*', async (c, next) => {
  await next()
  c.header('X-Robots-Tag', 'noindex, nofollow, noarchive')
})

app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')

  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    await next()
    return
  }

  if (!isSameOrigin(c.req.raw)) {
    return jsonError(c, 403, 'ORIGIN_FORBIDDEN', '只接受同源寫入請求')
  }

  if (contentLengthExceeds(c.req.raw)) {
    return jsonError(c, 413, 'PAYLOAD_TOO_LARGE', `請求內容不得超過 ${MAX_JSON_BODY_BYTES} bytes`)
  }

  await next()
})

app.get('/api/health', async (c) => {
  await c.env.DB.prepare('SELECT 1 AS ready').first<{ ready: number }>()
  return jsonSuccess(c, { status: 'healthy' })
})

app.get('/api/accounts', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT
      id,
      name,
      type,
      currency,
      is_active AS isActive,
      sort_order AS sortOrder,
      localization_key AS localizationKey
    FROM accounts
    ORDER BY is_active DESC, sort_order ASC, id ASC
  `).all<AccountRow>()

  return jsonSuccess(
    c,
    result.results.map((row) => ({ ...row, isActive: row.isActive === 1 })),
  )
})

app.get('/api/categories', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT
      id,
      name,
      type,
      icon,
      color,
      is_active AS isActive,
      sort_order AS sortOrder,
      localization_key AS localizationKey
    FROM categories
    ORDER BY type DESC, is_active DESC, sort_order ASC, id ASC
  `).all<CategoryRow>()

  return jsonSuccess(
    c,
    result.results.map((row) => ({ ...row, isActive: row.isActive === 1 })),
  )
})

app.get('/api/transactions', async (c) => {
  const parsed = transactionQuerySchema.safeParse(queryObject(c.req.raw))
  if (!parsed.success) {
    return jsonError(
      c,
      400,
      'INVALID_QUERY',
      '交易查詢參數不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const { start, end } = monthRangeDates(parsed.data.month)
  const filters = ['t.occurred_on >= ?', 't.occurred_on < ?']
  const values: Array<string> = [start, end]

  if (parsed.data.type) {
    filters.push('t.type = ?')
    values.push(parsed.data.type)
  }

  if (parsed.data.search) {
    const search = `%${escapeLike(parsed.data.search)}%`
    filters.push(`(
      t.payee LIKE ? ESCAPE '\\'
      OR t.note LIKE ? ESCAPE '\\'
      OR a.name LIKE ? ESCAPE '\\'
      OR category.name LIKE ? ESCAPE '\\'
    )`)
    values.push(search, search, search, search)
  }

  const result = await c.env.DB.prepare(`
    ${transactionSelect}
    WHERE ${filters.join(' AND ')}
    ORDER BY t.occurred_on DESC, t.created_at DESC, t.id DESC
    LIMIT 200
  `)
    .bind(...values)
    .all<TransactionRow>()

  return jsonSuccess(c, result.results)
})

app.post('/api/transactions', async (c) => {
  let body: unknown
  try {
    body = await readJsonBody(c.req.raw)
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return jsonError(c, 413, 'PAYLOAD_TOO_LARGE', `請求內容不得超過 ${MAX_JSON_BODY_BYTES} bytes`)
    }
    if (error instanceof UnsupportedMediaTypeError) {
      return jsonError(c, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必須是 application/json')
    }
    if (error instanceof InvalidJsonError) {
      return jsonError(c, 400, 'INVALID_JSON', '請求內容不是有效 JSON')
    }
    throw error
  }

  const parsed = transactionInputSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError(
      c,
      400,
      'VALIDATION_ERROR',
      '交易資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const existing = await findTransaction(c.env.DB, parsed.data.id)
  if (existing) {
    if (!matchesInput(existing, parsed.data)) {
      return jsonError(c, 409, 'ID_CONFLICT', '交易 ID 已用於另一筆資料')
    }
    return jsonSuccess(c, existing)
  }

  const [account, category] = await Promise.all([
    c.env.DB.prepare(`
      SELECT id, is_active AS isActive, currency
      FROM accounts
      WHERE id = ?
    `)
      .bind(parsed.data.accountId)
      .first<ReferenceRow>(),
    c.env.DB.prepare(`
      SELECT id, is_active AS isActive, type
      FROM categories
      WHERE id = ?
    `)
      .bind(parsed.data.categoryId)
      .first<ReferenceRow>(),
  ])

  if (!account || account.isActive !== 1 || account.currency !== parsed.data.currency) {
    return jsonError(c, 400, 'ACCOUNT_INVALID', '帳戶不存在、已停用或幣別不相符')
  }

  if (!category || category.isActive !== 1) {
    return jsonError(c, 400, 'CATEGORY_INVALID', '分類不存在或已停用')
  }

  if (category.type !== parsed.data.type) {
    return jsonError(c, 400, 'CATEGORY_TYPE_MISMATCH', '分類與交易類型不相符')
  }

  const inserted = await c.env.DB.prepare(`
    INSERT INTO transactions(
      id,
      type,
      amount_minor,
      currency,
      account_id,
      category_id,
      occurred_on,
      payee,
      note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `)
    .bind(
      parsed.data.id,
      parsed.data.type,
      parsed.data.amountMinor,
      parsed.data.currency,
      parsed.data.accountId,
      parsed.data.categoryId,
      parsed.data.occurredOn,
      parsed.data.payee,
      parsed.data.note,
    )
    .run()

  const transaction = await findTransaction(c.env.DB, parsed.data.id)
  if (!transaction) throw new Error('Transaction insert did not produce a row')

  if (!matchesInput(transaction, parsed.data)) {
    return jsonError(c, 409, 'ID_CONFLICT', '交易 ID 已用於另一筆資料')
  }

  return jsonSuccess(c, transaction, Number(inserted.meta.changes) > 0 ? 201 : 200)
})

app.get('/api/recurring-rules', async (c) => {
  return jsonSuccess(c, await listRecurringRules(c.env.DB))
})

app.get('/api/recurring-rules/:id', async (c) => {
  const id = recurringRuleIdSchema.safeParse(c.req.param('id'))
  if (!id.success) {
    return jsonError(
      c,
      400,
      'INVALID_RULE_ID',
      '週期交易 ID 不正確',
      sanitizeValidationIssues(id.error.issues),
    )
  }

  const rule = await getRecurringRule(c.env.DB, id.data)
  return rule
    ? jsonSuccess(c, rule)
    : jsonError(c, 404, 'RULE_NOT_FOUND', '找不到指定的週期交易')
})

app.post('/api/recurring-rules', async (c) => {
  const body = await readApiJson(c)
  if (!body.ok) return body.response

  const parsed = recurringRuleCreateSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      c,
      400,
      'VALIDATION_ERROR',
      '週期交易資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const result = await createRecurringRule(c.env.DB, parsed.data)
  if (result.kind === 'id_conflict') {
    return jsonError(c, 409, 'ID_CONFLICT', '週期交易 ID 已用於另一筆資料')
  }
  if (result.kind === 'reference_invalid') return referenceError(c, result.code)
  return jsonSuccess(c, result.rule, result.kind === 'created' ? 201 : 200)
})

app.post('/api/recurring-rules/run-due', async (c) => {
  const body = await readApiJson(c)
  if (!body.ok) return body.response

  const parsed = recurringRunDueSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      c,
      400,
      'VALIDATION_ERROR',
      '週期交易執行資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }
  if (parsed.data.asOf && !isLocalDevelopmentRequest(c.req.raw)) {
    return jsonError(c, 403, 'AS_OF_FORBIDDEN', '只可在本機開發環境指定執行日期')
  }

  return jsonSuccess(c, await runDueRecurringRules(c.env.DB, parsed.data.asOf ?? hktCalendarDate()))
})

app.put('/api/recurring-rules/:id', async (c) => {
  const id = recurringRuleIdSchema.safeParse(c.req.param('id'))
  if (!id.success) {
    return jsonError(
      c,
      400,
      'INVALID_RULE_ID',
      '週期交易 ID 不正確',
      sanitizeValidationIssues(id.error.issues),
    )
  }

  const body = await readApiJson(c)
  if (!body.ok) return body.response
  const parsed = recurringRuleUpdateSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      c,
      400,
      'VALIDATION_ERROR',
      '週期交易資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return recurringMutationResponse(c, await updateRecurringRule(c.env.DB, id.data, parsed.data))
})

app.patch('/api/recurring-rules/:id/status', async (c) => {
  const id = recurringRuleIdSchema.safeParse(c.req.param('id'))
  if (!id.success) {
    return jsonError(
      c,
      400,
      'INVALID_RULE_ID',
      '週期交易 ID 不正確',
      sanitizeValidationIssues(id.error.issues),
    )
  }

  const body = await readApiJson(c)
  if (!body.ok) return body.response
  const parsed = recurringRuleStatusSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      c,
      400,
      'VALIDATION_ERROR',
      '週期交易狀態不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return recurringMutationResponse(
    c,
    await setRecurringRuleStatus(c.env.DB, id.data, parsed.data),
  )
})

app.delete('/api/recurring-rules/:id', async (c) => {
  const id = recurringRuleIdSchema.safeParse(c.req.param('id'))
  if (!id.success) {
    return jsonError(
      c,
      400,
      'INVALID_RULE_ID',
      '週期交易 ID 不正確',
      sanitizeValidationIssues(id.error.issues),
    )
  }

  const body = await readApiJson(c)
  if (!body.ok) return body.response
  const parsed = recurringRuleDeleteSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      c,
      400,
      'VALIDATION_ERROR',
      '刪除週期交易資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const result = await deleteRecurringRule(c.env.DB, id.data, parsed.data.revision)
  if (result.kind === 'not_found') {
    return jsonError(c, 404, 'RULE_NOT_FOUND', '找不到指定的週期交易')
  }
  if (result.kind === 'version_conflict') {
    return jsonError(c, 409, 'RULE_VERSION_CONFLICT', '週期交易已被修改，請重新載入後再試')
  }
  return jsonSuccess(c, { id: result.id, deleted: true, revision: result.revision })
})

app.get('/api/summary', async (c) => {
  const parsed = summaryQuerySchema.safeParse(queryObject(c.req.raw))
  if (!parsed.success) {
    return jsonError(
      c,
      400,
      'INVALID_QUERY',
      '月份查詢參數不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const { start, end } = monthRangeDates(parsed.data.month)
  const row = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount_minor ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_minor ELSE 0 END), 0) AS expense
    FROM transactions
    WHERE occurred_on >= ? AND occurred_on < ?
  `)
    .bind(start, end)
    .first<SummaryRow>()

  const income = row?.income ?? 0
  const expense = row?.expense ?? 0
  return jsonSuccess(c, {
    month: parsed.data.month,
    income,
    expense,
    balance: income - expense,
  })
})

app.all('/api/*', (c) => jsonError(c, 404, 'NOT_FOUND', '找不到指定的 API'))

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

app.onError((_, c) => {
  console.error('request_failed', { method: c.req.method })
  return jsonError(c, 500, 'INTERNAL_ERROR', '伺服器暫時無法處理請求')
})

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

async function findTransaction(database: D1Database, id: string) {
  return database
    .prepare(`${transactionSelect} WHERE t.id = ? LIMIT 1`)
    .bind(id)
    .first<TransactionRow>()
}

function matchesInput(transaction: TransactionRow, input: TransactionInput) {
  return (
    transaction.id === input.id &&
    transaction.type === input.type &&
    transaction.amountMinor === input.amountMinor &&
    transaction.currency === input.currency &&
    transaction.accountId === input.accountId &&
    transaction.categoryId === input.categoryId &&
    transaction.occurredOn === input.occurredOn &&
    transaction.payee === input.payee &&
    transaction.note === input.note
  )
}

async function readApiJson(c: AppContext) {
  try {
    return { ok: true as const, data: await readJsonBody(c.req.raw) }
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return {
        ok: false as const,
        response: jsonError(
          c,
          413,
          'PAYLOAD_TOO_LARGE',
          `請求內容不得超過 ${MAX_JSON_BODY_BYTES} bytes`,
        ),
      }
    }
    if (error instanceof UnsupportedMediaTypeError) {
      return {
        ok: false as const,
        response: jsonError(c, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必須是 application/json'),
      }
    }
    if (error instanceof InvalidJsonError) {
      return {
        ok: false as const,
        response: jsonError(c, 400, 'INVALID_JSON', '請求內容不是有效 JSON'),
      }
    }
    throw error
  }
}

function referenceError(c: AppContext, code: ReferenceErrorCode) {
  if (code === 'ACCOUNT_INVALID') {
    return jsonError(c, 400, code, '帳戶不存在、已停用或幣別不相符')
  }
  if (code === 'CATEGORY_INVALID') {
    return jsonError(c, 400, code, '分類不存在或已停用')
  }
  return jsonError(c, 400, code, '分類與交易類型不相符')
}

function recurringMutationResponse(c: AppContext, result: UpdateRuleResult) {
  if (result.kind === 'not_found') {
    return jsonError(c, 404, 'RULE_NOT_FOUND', '找不到指定的週期交易')
  }
  if (result.kind === 'version_conflict') {
    return jsonError(c, 409, 'RULE_VERSION_CONFLICT', '週期交易已被修改，請重新載入後再試')
  }
  if (result.kind === 'reference_invalid') return referenceError(c, result.code)
  return jsonSuccess(c, result.rule)
}

function isLocalDevelopmentRequest(request: Request) {
  const hostname = new URL(request.url).hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

const worker = {
  fetch(request: Request, env: Env, executionContext: ExecutionContext) {
    return app.fetch(request, env, executionContext)
  },
  async scheduled(controller: ScheduledController, env: Env) {
    const result = await runDueRecurringRules(env.DB, hktCalendarDate(controller.scheduledTime))
    console.info('recurring_rules_run', { trigger: 'cron', ...result })
  },
} satisfies ExportedHandler<Env>

export default worker
