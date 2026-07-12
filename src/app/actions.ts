'use server'

import { revalidatePath } from 'next/cache'
import {
  recurringRuleCreateSchema,
  recurringRuleDeleteSchema,
  recurringRuleStatusSchema,
  recurringRuleUpdateSchema,
  transactionInputSchema,
  type RecurringGenerationResult,
} from '../lib/schema'
import {
  actionError,
  actionSuccess,
  type ActionResult,
} from '../server/action-result'
import { isServerActionAllowed } from '../server/auth'
import { getDatabase } from '../server/db'
import { sanitizeValidationIssues } from '../server/http'
import {
  createTransaction,
  type TransactionView,
} from '../server/money'
import {
  createRecurringRule,
  deleteRecurringRule,
  runDueRecurringRules,
  setRecurringRuleStatus,
  updateRecurringRule,
  type RecurringRuleView,
  type ReferenceErrorCode,
  type UpdateRuleResult,
} from '../server/recurring'
import { emptyActionSchema, recurringRuleIdSchema } from '../server/validation'

type DeletedRule = { id: string; deleted: true; revision: number }

export async function createTransactionAction(
  input: unknown,
): Promise<ActionResult<TransactionView>> {
  const denied = await accessDenied<TransactionView>()
  if (denied) return denied

  const parsed = transactionInputSchema.safeParse(input)
  if (!parsed.success) {
    return validationError('交易資料不正確', parsed.error.issues)
  }

  return runAction('create_transaction', async () => {
    const result = await createTransaction(await getDatabase(), parsed.data)
    if (result.kind === 'id_conflict') {
      return actionError('ID_CONFLICT', '交易 ID 已用於另一筆資料')
    }
    if (result.kind === 'reference_invalid') return referenceError(result.code)
    return revalidatedSuccess(result.transaction)
  })
}

export async function createRecurringRuleAction(
  input: unknown,
): Promise<ActionResult<RecurringRuleView>> {
  const denied = await accessDenied<RecurringRuleView>()
  if (denied) return denied

  const parsed = recurringRuleCreateSchema.safeParse(input)
  if (!parsed.success) {
    return validationError('週期交易資料不正確', parsed.error.issues)
  }

  return runAction('create_recurring_rule', async () => {
    const result = await createRecurringRule(await getDatabase(), parsed.data)
    if (result.kind === 'id_conflict') {
      return actionError('ID_CONFLICT', '週期交易 ID 已用於另一筆資料')
    }
    if (result.kind === 'reference_invalid') return referenceError(result.code)
    return revalidatedSuccess(result.rule)
  })
}

export async function updateRecurringRuleAction(
  idInput: unknown,
  input: unknown,
): Promise<ActionResult<RecurringRuleView>> {
  const denied = await accessDenied<RecurringRuleView>()
  if (denied) return denied

  const id = recurringRuleIdSchema.safeParse(idInput)
  if (!id.success) return invalidRuleId(id.error.issues)

  const parsed = recurringRuleUpdateSchema.safeParse(input)
  if (!parsed.success) {
    return validationError('週期交易資料不正確', parsed.error.issues)
  }

  return runAction('update_recurring_rule', async () => {
    const result = await updateRecurringRule(await getDatabase(), id.data, parsed.data)
    return recurringMutationResult(result)
  })
}

export async function setRecurringRuleStatusAction(
  idInput: unknown,
  input: unknown,
): Promise<ActionResult<RecurringRuleView>> {
  const denied = await accessDenied<RecurringRuleView>()
  if (denied) return denied

  const id = recurringRuleIdSchema.safeParse(idInput)
  if (!id.success) return invalidRuleId(id.error.issues)

  const parsed = recurringRuleStatusSchema.safeParse(input)
  if (!parsed.success) {
    return validationError('週期交易狀態不正確', parsed.error.issues)
  }

  return runAction('set_recurring_rule_status', async () => {
    const result = await setRecurringRuleStatus(await getDatabase(), id.data, parsed.data)
    return recurringMutationResult(result)
  })
}

export async function deleteRecurringRuleAction(
  idInput: unknown,
  input: unknown,
): Promise<ActionResult<DeletedRule>> {
  const denied = await accessDenied<DeletedRule>()
  if (denied) return denied

  const id = recurringRuleIdSchema.safeParse(idInput)
  if (!id.success) return invalidRuleId(id.error.issues)

  const parsed = recurringRuleDeleteSchema.safeParse(input)
  if (!parsed.success) {
    return validationError('刪除週期交易資料不正確', parsed.error.issues)
  }

  return runAction('delete_recurring_rule', async () => {
    const result = await deleteRecurringRule(await getDatabase(), id.data, parsed.data.revision)
    if (result.kind === 'not_found') {
      return actionError('RULE_NOT_FOUND', '找不到指定的週期交易')
    }
    if (result.kind === 'version_conflict') {
      return actionError('RULE_VERSION_CONFLICT', '週期交易已被修改，請重新載入後再試')
    }
    return revalidatedSuccess({ id: result.id, deleted: true, revision: result.revision })
  })
}

export async function runDueRecurringRulesAction(
  input: unknown = {},
): Promise<ActionResult<RecurringGenerationResult>> {
  const denied = await accessDenied<RecurringGenerationResult>()
  if (denied) return denied

  const parsed = emptyActionSchema.safeParse(input)
  if (!parsed.success) {
    return validationError('週期交易執行資料不正確', parsed.error.issues)
  }

  return runAction('run_due_recurring_rules', async () => {
    const result = await runDueRecurringRules(await getDatabase())
    return revalidatedSuccess(result)
  })
}

async function runAction<T>(
  name: string,
  operation: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await operation()
  } catch {
    console.error('server_action_failed', { action: name })
    return actionError('INTERNAL_ERROR', '伺服器暫時無法處理請求')
  }
}

function revalidatedSuccess<T>(data: T): ActionResult<T> {
  revalidatePath('/')
  return actionSuccess(data)
}

function validationError<T>(message: string, issues: Parameters<typeof sanitizeValidationIssues>[0]) {
  return actionError<T>('VALIDATION_ERROR', message, sanitizeValidationIssues(issues))
}

function invalidRuleId<T>(issues: Parameters<typeof sanitizeValidationIssues>[0]) {
  return actionError<T>(
    'INVALID_RULE_ID',
    '週期交易 ID 不正確',
    sanitizeValidationIssues(issues),
  )
}

function referenceError<T>(code: ReferenceErrorCode): ActionResult<T> {
  if (code === 'ACCOUNT_INVALID') {
    return actionError(code, '帳戶不存在、已停用或幣別不相符')
  }
  if (code === 'CATEGORY_INVALID') {
    return actionError(code, '分類不存在或已停用')
  }
  return actionError(code, '分類與交易類型不相符')
}

function recurringMutationResult(result: UpdateRuleResult): ActionResult<RecurringRuleView> {
  if (result.kind === 'not_found') {
    return actionError('RULE_NOT_FOUND', '找不到指定的週期交易')
  }
  if (result.kind === 'version_conflict') {
    return actionError('RULE_VERSION_CONFLICT', '週期交易已被修改，請重新載入後再試')
  }
  if (result.kind === 'reference_invalid') return referenceError(result.code)
  return revalidatedSuccess(result.rule)
}

async function accessDenied<T>() {
  return (await isServerActionAllowed())
    ? null
    : actionError<T>('ACCESS_FORBIDDEN', '無法驗證存取權限')
}
