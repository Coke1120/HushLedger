'use server'

import { revalidatePath } from 'next/cache'
import {
  accountCreateSchema,
  accountTransferDeleteSchema,
  accountTransferInputSchema,
  accountTransferUpdateSchema,
  accountUpdateSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  referenceIdSchema,
  referenceOrderSchema,
  referenceStatusSchema,
  recurringRuleCreateSchema,
  recurringRuleDeleteSchema,
  recurringRuleSkipSchema,
  recurringRuleStatusSchema,
  recurringRuleUpdateSchema,
  transactionDeleteSchema,
  transactionIdSchema,
  transactionInputSchema,
  transactionUpdateSchema,
  type RecurringGenerationResult,
  type Account,
  type AccountTransfer,
  type Category,
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
  deleteTransaction,
  updateTransaction,
  type TransactionView,
  type UpdateTransactionResult,
} from '../server/money'
import {
  createAccountReference,
  createCategoryReference,
  reorderAccountReferences,
  reorderCategoryReferences,
  setAccountReferenceStatus,
  setCategoryReferenceStatus,
  updateAccountReference,
  updateCategoryReference,
  type ReferenceMutationResult,
  type ReferenceOrderResult,
} from '../server/referenceData'
import {
  createRecurringRule,
  deleteRecurringRule,
  runDueRecurringRules,
  setRecurringRuleStatus,
  skipRecurringRuleOccurrence,
  updateRecurringRule,
  type RecurringRuleView,
  type ReferenceErrorCode,
  type UpdateRuleResult,
} from '../server/recurring'
import {
  createAccountTransfer,
  deleteAccountTransfer,
  updateAccountTransfer,
  type UpdateAccountTransferResult,
} from '../server/transfers'
import { emptyActionSchema, recurringRuleIdSchema } from '../server/validation'

type DeletedRule = { id: string; deleted: true; revision: number }
type DeletedTransaction = { id: string; deleted: true }
type DeletedTransfer = { id: string; deleted: true }

export async function createAccountAction(input: unknown): Promise<ActionResult<Account>> {
  const denied = await accessDenied<Account>()
  if (denied) return denied

  const parsed = accountCreateSchema.safeParse(input)
  if (!parsed.success) return validationError('帳戶資料不正確', parsed.error.issues)

  return runAction('create_account', async () => referenceMutationResult(
    await createAccountReference(await getDatabase(), parsed.data),
  ))
}

export async function updateAccountAction(
  idInput: unknown,
  input: unknown,
): Promise<ActionResult<Account>> {
  const denied = await accessDenied<Account>()
  if (denied) return denied

  const id = referenceIdSchema.safeParse(idInput)
  if (!id.success) return invalidReferenceId(id.error.issues)
  const parsed = accountUpdateSchema.safeParse(input)
  if (!parsed.success) return validationError('帳戶資料不正確', parsed.error.issues)

  return runAction('update_account', async () => referenceMutationResult(
    await updateAccountReference(await getDatabase(), id.data, parsed.data),
  ))
}

export async function setAccountStatusAction(
  idInput: unknown,
  input: unknown,
): Promise<ActionResult<Account>> {
  const denied = await accessDenied<Account>()
  if (denied) return denied

  const id = referenceIdSchema.safeParse(idInput)
  if (!id.success) return invalidReferenceId(id.error.issues)
  const parsed = referenceStatusSchema.safeParse(input)
  if (!parsed.success) return validationError('帳戶狀態不正確', parsed.error.issues)

  return runAction('set_account_status', async () => referenceMutationResult(
    await setAccountReferenceStatus(await getDatabase(), id.data, parsed.data),
  ))
}

export async function reorderAccountsAction(input: unknown): Promise<ActionResult<Account[]>> {
  const denied = await accessDenied<Account[]>()
  if (denied) return denied

  const parsed = referenceOrderSchema.safeParse(input)
  if (!parsed.success) return validationError('帳戶排序資料不正確', parsed.error.issues)

  return runAction('reorder_accounts', async () => referenceOrderResult(
    await reorderAccountReferences(await getDatabase(), parsed.data),
  ))
}

export async function createCategoryAction(input: unknown): Promise<ActionResult<Category>> {
  const denied = await accessDenied<Category>()
  if (denied) return denied

  const parsed = categoryCreateSchema.safeParse(input)
  if (!parsed.success) return validationError('分類資料不正確', parsed.error.issues)

  return runAction('create_category', async () => referenceMutationResult(
    await createCategoryReference(await getDatabase(), parsed.data),
  ))
}

export async function updateCategoryAction(
  idInput: unknown,
  input: unknown,
): Promise<ActionResult<Category>> {
  const denied = await accessDenied<Category>()
  if (denied) return denied

  const id = referenceIdSchema.safeParse(idInput)
  if (!id.success) return invalidReferenceId(id.error.issues)
  const parsed = categoryUpdateSchema.safeParse(input)
  if (!parsed.success) return validationError('分類資料不正確', parsed.error.issues)

  return runAction('update_category', async () => referenceMutationResult(
    await updateCategoryReference(await getDatabase(), id.data, parsed.data),
  ))
}

export async function setCategoryStatusAction(
  idInput: unknown,
  input: unknown,
): Promise<ActionResult<Category>> {
  const denied = await accessDenied<Category>()
  if (denied) return denied

  const id = referenceIdSchema.safeParse(idInput)
  if (!id.success) return invalidReferenceId(id.error.issues)
  const parsed = referenceStatusSchema.safeParse(input)
  if (!parsed.success) return validationError('分類狀態不正確', parsed.error.issues)

  return runAction('set_category_status', async () => referenceMutationResult(
    await setCategoryReferenceStatus(await getDatabase(), id.data, parsed.data),
  ))
}

export async function reorderCategoriesAction(input: unknown): Promise<ActionResult<Category[]>> {
  const denied = await accessDenied<Category[]>()
  if (denied) return denied

  const parsed = referenceOrderSchema.safeParse(input)
  if (!parsed.success) return validationError('分類排序資料不正確', parsed.error.issues)

  return runAction('reorder_categories', async () => referenceOrderResult(
    await reorderCategoryReferences(await getDatabase(), parsed.data),
  ))
}

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

export async function updateTransactionAction(
  idInput: unknown,
  input: unknown,
): Promise<ActionResult<TransactionView>> {
  const denied = await accessDenied<TransactionView>()
  if (denied) return denied

  const id = transactionIdSchema.safeParse(idInput)
  if (!id.success) return invalidTransactionId(id.error.issues)

  const parsed = transactionUpdateSchema.safeParse(input)
  if (!parsed.success) {
    return validationError('交易資料不正確', parsed.error.issues)
  }

  return runAction('update_transaction', async () => {
    const result = await updateTransaction(await getDatabase(), id.data, parsed.data)
    return transactionMutationResult(result)
  })
}

export async function deleteTransactionAction(
  idInput: unknown,
  input: unknown,
): Promise<ActionResult<DeletedTransaction>> {
  const denied = await accessDenied<DeletedTransaction>()
  if (denied) return denied

  const id = transactionIdSchema.safeParse(idInput)
  if (!id.success) return invalidTransactionId(id.error.issues)

  const parsed = transactionDeleteSchema.safeParse(input)
  if (!parsed.success) {
    return validationError('刪除交易資料不正確', parsed.error.issues)
  }

  return runAction('delete_transaction', async () => {
    const result = await deleteTransaction(await getDatabase(), id.data, parsed.data.updatedAt)
    if (result.kind === 'not_found') {
      return actionError('TRANSACTION_NOT_FOUND', '找不到指定的交易')
    }
    if (result.kind === 'version_conflict') {
      return actionError('TRANSACTION_VERSION_CONFLICT', '交易已被修改，請重新載入後再試')
    }
    return revalidatedSuccess({ id: result.id, deleted: true })
  })
}

export async function createAccountTransferAction(
  input: unknown,
): Promise<ActionResult<AccountTransfer>> {
  const denied = await accessDenied<AccountTransfer>()
  if (denied) return denied

  const parsed = accountTransferInputSchema.safeParse(input)
  if (!parsed.success) {
    return validationError('帳戶轉帳資料不正確', parsed.error.issues)
  }

  return runAction('create_account_transfer', async () => {
    const result = await createAccountTransfer(await getDatabase(), parsed.data)
    if (result.kind === 'id_conflict') {
      return actionError('ID_CONFLICT', '帳戶轉帳 ID 已用於另一筆資料')
    }
    if (result.kind === 'reference_invalid') return referenceError('ACCOUNT_INVALID')
    return revalidatedSuccess(result.transfer)
  })
}

export async function updateAccountTransferAction(
  idInput: unknown,
  input: unknown,
): Promise<ActionResult<AccountTransfer>> {
  const denied = await accessDenied<AccountTransfer>()
  if (denied) return denied

  const id = transactionIdSchema.safeParse(idInput)
  if (!id.success) return invalidTransferId(id.error.issues)

  const parsed = accountTransferUpdateSchema.safeParse(input)
  if (!parsed.success) {
    return validationError('帳戶轉帳資料不正確', parsed.error.issues)
  }

  return runAction('update_account_transfer', async () => transferMutationResult(
    await updateAccountTransfer(await getDatabase(), id.data, parsed.data),
  ))
}

export async function deleteAccountTransferAction(
  idInput: unknown,
  input: unknown,
): Promise<ActionResult<DeletedTransfer>> {
  const denied = await accessDenied<DeletedTransfer>()
  if (denied) return denied

  const id = transactionIdSchema.safeParse(idInput)
  if (!id.success) return invalidTransferId(id.error.issues)

  const parsed = accountTransferDeleteSchema.safeParse(input)
  if (!parsed.success) {
    return validationError('刪除帳戶轉帳資料不正確', parsed.error.issues)
  }

  return runAction('delete_account_transfer', async () => {
    const result = await deleteAccountTransfer(await getDatabase(), id.data, parsed.data.updatedAt)
    if (result.kind === 'not_found') {
      return actionError('TRANSFER_NOT_FOUND', '找不到指定的帳戶轉帳')
    }
    if (result.kind === 'version_conflict') {
      return actionError('TRANSFER_VERSION_CONFLICT', '帳戶轉帳已被修改，請重新載入後再試')
    }
    return revalidatedSuccess({ id: result.id, deleted: true })
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

export async function skipRecurringRuleOccurrenceAction(
  idInput: unknown,
  input: unknown,
): Promise<ActionResult<RecurringRuleView>> {
  const denied = await accessDenied<RecurringRuleView>()
  if (denied) return denied

  const id = recurringRuleIdSchema.safeParse(idInput)
  if (!id.success) return invalidRuleId(id.error.issues)

  const parsed = recurringRuleSkipSchema.safeParse(input)
  if (!parsed.success) {
    return validationError('略過週期交易資料不正確', parsed.error.issues)
  }

  return runAction('skip_recurring_rule_occurrence', async () => {
    const result = await skipRecurringRuleOccurrence(await getDatabase(), id.data, parsed.data)
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

function invalidTransactionId<T>(issues: Parameters<typeof sanitizeValidationIssues>[0]) {
  return actionError<T>(
    'INVALID_TRANSACTION_ID',
    '交易 ID 不正確',
    sanitizeValidationIssues(issues),
  )
}

function invalidTransferId<T>(issues: Parameters<typeof sanitizeValidationIssues>[0]) {
  return actionError<T>(
    'INVALID_TRANSFER_ID',
    '帳戶轉帳 ID 不正確',
    sanitizeValidationIssues(issues),
  )
}

function invalidReferenceId<T>(issues: Parameters<typeof sanitizeValidationIssues>[0]) {
  return actionError<T>(
    'INVALID_REFERENCE_ID',
    '帳戶或分類 ID 不正確',
    sanitizeValidationIssues(issues),
  )
}

function referenceMutationResult<T>(result: ReferenceMutationResult<T>): ActionResult<T> {
  if (result.kind === 'created' || result.kind === 'updated') {
    return revalidatedSuccess(result.item)
  }
  if (result.kind === 'not_found') {
    return actionError('REFERENCE_NOT_FOUND', '找不到指定的帳戶或分類')
  }
  if (result.kind === 'version_conflict') {
    return actionError('REFERENCE_VERSION_CONFLICT', '帳戶或分類已被修改，請重新載入後再試')
  }
  if (result.kind === 'name_conflict') {
    return actionError('REFERENCE_NAME_CONFLICT', '同類型已有相同名稱')
  }
  if (result.kind === 'last_active') {
    return actionError('REFERENCE_LAST_ACTIVE', '必須保留至少一個可用項目')
  }
  if (result.kind === 'active_rules') {
    return actionError('REFERENCE_ACTIVE_RULES', '請先暫停或修改使用此項目的週期交易')
  }
  return actionError('INTERNAL_ERROR', '伺服器暫時無法處理請求')
}

function referenceOrderResult<T>(result: ReferenceOrderResult<T>): ActionResult<T[]> {
  if (result.kind === 'updated') return revalidatedSuccess(result.items)
  return actionError('REFERENCE_VERSION_CONFLICT', '帳戶或分類已被修改，請重新載入後再試')
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

function transactionMutationResult(result: UpdateTransactionResult): ActionResult<TransactionView> {
  if (result.kind === 'not_found') {
    return actionError('TRANSACTION_NOT_FOUND', '找不到指定的交易')
  }
  if (result.kind === 'version_conflict') {
    return actionError('TRANSACTION_VERSION_CONFLICT', '交易已被修改，請重新載入後再試')
  }
  if (result.kind === 'reference_invalid') return referenceError(result.code)
  return revalidatedSuccess(result.transaction)
}

function transferMutationResult(result: UpdateAccountTransferResult): ActionResult<AccountTransfer> {
  if (result.kind === 'not_found') {
    return actionError('TRANSFER_NOT_FOUND', '找不到指定的帳戶轉帳')
  }
  if (result.kind === 'version_conflict') {
    return actionError('TRANSFER_VERSION_CONFLICT', '帳戶轉帳已被修改，請重新載入後再試')
  }
  if (result.kind === 'reference_invalid') return referenceError('ACCOUNT_INVALID')
  return revalidatedSuccess(result.transfer)
}

async function accessDenied<T>() {
  return (await isServerActionAllowed())
    ? null
    : actionError<T>('ACCESS_FORBIDDEN', '無法驗證存取權限')
}
