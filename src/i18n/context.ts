'use client'

import { createContext, useContext } from 'react'
import type { Locale, Translator } from './core'

export type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translator
  formatMoney: (minor: number, currency?: string) => string
  formatMonth: (month: string) => string
  formatDate: (date: string) => string
  formatNumber: (value: number) => string
  localizeEntityName: (name: string, localizationKey?: string | null) => string
}

export const I18nContext = createContext<I18nContextValue | null>(null)

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used within I18nProvider')
  return context
}
