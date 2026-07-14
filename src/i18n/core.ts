import {
  enMessages,
  frMessages,
  jaMessages,
  zhHantMessages,
  type MessageDictionary,
  type MessageKey,
} from './messages'

export const supportedLocales = ['zh-Hant', 'en', 'ja', 'fr'] as const
export type Locale = (typeof supportedLocales)[number]
export type MessageValue = string | number
export type MessageValues = Record<string, MessageValue>
export type Translator = (key: MessageKey, values?: MessageValues) => string

export const LOCALE_STORAGE_KEY = 'hushledger.locale'

export const languageOptions: ReadonlyArray<{ locale: Locale; label: string }> = [
  { locale: 'zh-Hant', label: '繁體中文' },
  { locale: 'en', label: 'English' },
  { locale: 'ja', label: '日本語' },
  { locale: 'fr', label: 'Français' },
]

export const dictionaries: Record<Locale, MessageDictionary> = {
  'zh-Hant': zhHantMessages,
  en: enMessages,
  ja: jaMessages,
  fr: frMessages,
}

const entityMessageKeys: Readonly<Record<string, MessageKey>> = {
  'account.cash': 'accountCash',
  'account.bank': 'accountBank',
  'account.credit_card': 'accountCreditCard',
  'account.wallet': 'accountWallet',
  'category.salary': 'categorySalary',
  'category.other_income': 'categoryOtherIncome',
  'category.food': 'categoryFood',
  'category.transport': 'categoryTransport',
  'category.living': 'categoryLiving',
  'category.shopping': 'categoryShopping',
  'category.housing': 'categoryHousing',
  'category.bills': 'categoryBills',
  'category.entertainment': 'categoryEntertainment',
  'category.healthcare': 'categoryHealthcare',
  'category.other_expense': 'categoryOtherExpense',
}

const singularMessageKeys: Partial<Record<MessageKey, MessageKey>> = {
  transactionCount: 'transactionCountOne',
  unclearedCount: 'unclearedCountOne',
  recurringRuleCount: 'recurringRuleCountOne',
  generatedCount: 'generatedCountOne',
  deleteRecurringDescription: 'deleteRecurringDescriptionOne',
  moreIncomeSources: 'moreIncomeSourcesOne',
  moreSpendingCategories: 'moreSpendingCategoriesOne',
  moreMonthlyPlans: 'moreMonthlyPlansOne',
  showMoreScheduledEntries: 'showMoreScheduledEntriesOne',
  showMoreScheduledTransfers: 'showMoreScheduledTransfersOne',
  reconciliationReviewHelp: 'reconciliationReviewHelpOne',
  reconciliationReviewHelpLimited: 'reconciliationReviewHelpLimitedOne',
  reconciliationReviewComplete: 'reconciliationReviewCompleteOne',
  csvImportSummaryMatchable: 'csvImportSummaryMatchableOne',
}

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && supportedLocales.includes(value as Locale)
}

function localeFromLanguageTag(value: string): Locale | undefined {
  const normalized = value.trim().replaceAll('_', '-').toLowerCase()
  if (!normalized) return undefined
  if (normalized === 'zh' || normalized === 'zh-hant' || normalized.startsWith('zh-')) return 'zh-Hant'
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja'
  if (normalized === 'fr' || normalized.startsWith('fr-')) return 'fr'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  return undefined
}

export function resolveLocale(
  storedLocale: unknown,
  browserLanguages: readonly string[] = [],
): Locale {
  if (isSupportedLocale(storedLocale)) return storedLocale
  for (const language of browserLanguages) {
    const locale = localeFromLanguageTag(language)
    if (locale) return locale
  }
  return 'zh-Hant'
}

function formatValue(locale: Locale, value: MessageValue) {
  return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value
}

export function translate(
  locale: Locale,
  key: MessageKey,
  values: MessageValues = {},
): string {
  const count = values.count
  const singularKey = singularMessageKeys[key]
  const resolvedKey =
    singularKey && count === 1
      ? singularKey
      : key
  const template = dictionaries[locale][resolvedKey]
    ?? dictionaries[locale][key]
    ?? dictionaries['zh-Hant'][resolvedKey]
    ?? dictionaries['zh-Hant'][key]
  if (typeof template !== 'string') return key
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (token, name: string) =>
    Object.hasOwn(values, name) ? formatValue(locale, values[name]) : token,
  )
}

export function localizeEntity(locale: Locale, name: string, localizationKey?: string | null) {
  const messageKey = localizationKey ? entityMessageKeys[localizationKey] : undefined
  return messageKey ? translate(locale, messageKey) : name
}
