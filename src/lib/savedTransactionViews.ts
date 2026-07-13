import { z } from 'zod'
import {
  transactionClearingStatusSchema,
  transactionDateScopeSchema,
  transactionSortSchema,
  transactionTypeSchema,
} from './schema'
import { isValidCalendarDate } from './date'
import { isTransactionTagName } from './transactionTags'

export const SAVED_TRANSACTION_VIEWS_STORAGE_KEY = 'hushledger:transaction-views:v1'
export const MAX_SAVED_TRANSACTION_VIEWS = 8

const savedTransactionViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(40),
  scope: transactionDateScopeSchema.default('month'),
  dateFrom: z.string().refine(isValidCalendarDate).nullable().default(null),
  dateTo: z.string().refine(isValidCalendarDate).nullable().default(null),
  type: transactionTypeSchema.or(z.literal('all')),
  status: transactionClearingStatusSchema.or(z.literal('all')),
  accountId: z.number().int().positive().nullable(),
  categoryId: z.number().int().positive().nullable(),
  payee: z.string().trim().min(1).max(80).nullable().default(null),
  search: z.string().trim().max(80),
  tag: z.string()
    .refine((value) => value.startsWith('#') && isTransactionTagName(value.slice(1)))
    .nullable(),
  duplicates: z.boolean().default(false),
  sort: transactionSortSchema.default('date_desc'),
}).strict().superRefine((view, context) => {
  if (view.scope === 'range') {
    if (view.dateFrom === null) {
      context.addIssue({ code: 'custom', path: ['dateFrom'], message: 'A range needs a start date' })
    }
    if (view.dateTo === null) {
      context.addIssue({ code: 'custom', path: ['dateTo'], message: 'A range needs an end date' })
    }
    if (view.dateFrom !== null && view.dateTo !== null && view.dateFrom > view.dateTo) {
      context.addIssue({ code: 'custom', path: ['dateTo'], message: 'The end date cannot precede the start date' })
    }
    return
  }

  if (view.dateFrom !== null) {
    context.addIssue({ code: 'custom', path: ['dateFrom'], message: 'Only a custom range can keep a start date' })
  }
  if (view.dateTo !== null) {
    context.addIssue({ code: 'custom', path: ['dateTo'], message: 'Only a custom range can keep an end date' })
  }
}).refine((view) => (
  view.scope !== 'month'
  || view.type !== 'all'
  || view.status !== 'all'
  || view.accountId !== null
  || view.categoryId !== null
  || view.payee !== null
  || view.search.length > 0
  || view.tag !== null
  || view.duplicates
  || view.sort !== 'date_desc'
), 'A saved view must contain at least one filter or a non-default sort')

export type SavedTransactionView = z.infer<typeof savedTransactionViewSchema>

export type AddSavedTransactionViewResult =
  | { kind: 'saved'; views: SavedTransactionView[] }
  | { kind: 'duplicate' | 'invalid' | 'limit'; views: SavedTransactionView[] }

const comparableName = (name: string) => name.trim().toLowerCase()

export function parseSavedTransactionViews(raw: string | null): SavedTransactionView[] {
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const views: SavedTransactionView[] = []
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const candidate of parsed) {
    const result = savedTransactionViewSchema.safeParse(candidate)
    if (!result.success) continue
    const name = comparableName(result.data.name)
    if (ids.has(result.data.id) || names.has(name)) continue
    ids.add(result.data.id)
    names.add(name)
    views.push(result.data)
    if (views.length === MAX_SAVED_TRANSACTION_VIEWS) break
  }
  return views
}

export function addSavedTransactionView(
  current: SavedTransactionView[],
  candidate: unknown,
): AddSavedTransactionViewResult {
  const parsed = savedTransactionViewSchema.safeParse(candidate)
  if (!parsed.success) return { kind: 'invalid', views: current }
  if (current.length >= MAX_SAVED_TRANSACTION_VIEWS) return { kind: 'limit', views: current }
  if (current.some(({ id }) => id === parsed.data.id)) return { kind: 'invalid', views: current }
  if (current.some(({ name }) => comparableName(name) === comparableName(parsed.data.name))) {
    return { kind: 'duplicate', views: current }
  }
  return { kind: 'saved', views: [...current, parsed.data] }
}

export function serializeSavedTransactionViews(views: SavedTransactionView[]) {
  return JSON.stringify(parseSavedTransactionViews(JSON.stringify(views)))
}
