'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { formatHongKongDate, formatMonthLabel } from '../lib/date'
import { formatMoneyForDisplay, shouldAutomaticallyMaskScreen } from '../lib/privacy'
import { I18nContext, type I18nContextValue } from './context'
import {
  LOCALE_STORAGE_KEY,
  localizeEntity,
  resolveLocale,
  translate,
  type Locale,
  type Translator,
} from './core'

function readBrowserLocale() {
  let storedLocale: string | null = null
  try {
    storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY)
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
  }

  const browserLanguages = navigator.languages?.length
    ? navigator.languages
    : navigator.language
      ? [navigator.language]
      : []
  return resolveLocale(storedLocale, browserLanguages)
}

function setMetaContent(selector: string, value: string) {
  document.querySelector<HTMLMetaElement>(selector)?.setAttribute('content', value)
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('zh-Hant')
  const [requestedPrivacyMode, setPrivacyMode] = useState(false)
  // Conceal the initial render until browser visibility and focus are known.
  const [automaticPrivacyMode, setAutomaticPrivacyMode] = useState(true)
  const privacyMode = requestedPrivacyMode || automaticPrivacyMode

  useEffect(() => {
    const browserLocale = readBrowserLocale()
    const timeout = window.setTimeout(() => setLocale(browserLocale), 0)
    return () => window.clearTimeout(timeout)
  }, [])

  useEffect(() => {
    const syncAutomaticPrivacyMode = () => {
      setAutomaticPrivacyMode(shouldAutomaticallyMaskScreen(
        document.visibilityState,
        document.hasFocus(),
      ))
    }
    const concealWhileUnfocused = () => setAutomaticPrivacyMode(true)

    syncAutomaticPrivacyMode()
    document.addEventListener('visibilitychange', syncAutomaticPrivacyMode)
    window.addEventListener('blur', concealWhileUnfocused)
    window.addEventListener('focus', syncAutomaticPrivacyMode)
    return () => {
      document.removeEventListener('visibilitychange', syncAutomaticPrivacyMode)
      window.removeEventListener('blur', concealWhileUnfocused)
      window.removeEventListener('focus', syncAutomaticPrivacyMode)
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    } catch {
      // The selected locale still applies for this session if persistence is unavailable.
    }

    const title = translate(locale, 'appTitle')
    const description = translate(locale, 'metaDescription')
    document.documentElement.lang = locale
    document.title = title
    setMetaContent('meta[name="description"]', description)
    setMetaContent('meta[property="og:title"]', title)
    setMetaContent('meta[property="og:description"]', description)
    setMetaContent('meta[name="twitter:title"]', title)
    setMetaContent('meta[name="twitter:description"]', description)
  }, [locale])

  const t = useCallback<Translator>((key, values) => translate(locale, key, values), [locale])
  const formatMoney = useCallback(
    (minor: number, currency = 'HKD') => formatMoneyForDisplay(
      minor,
      currency,
      locale,
      privacyMode,
    ),
    [locale, privacyMode],
  )
  const formatMonth = useCallback((month: string) => formatMonthLabel(month, locale), [locale])
  const formatDate = useCallback((date: string) => formatHongKongDate(date, locale), [locale])
  const formatNumber = useCallback((value: number) => new Intl.NumberFormat(locale).format(value), [locale])
  const localizeEntityName = useCallback(
    (name: string, localizationKey?: string | null) => localizeEntity(locale, name, localizationKey),
    [locale],
  )

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      privacyMode,
      setPrivacyMode,
      t,
      formatMoney,
      formatMonth,
      formatDate,
      formatNumber,
      localizeEntityName,
    }),
    [
      formatDate,
      formatMoney,
      formatMonth,
      formatNumber,
      locale,
      localizeEntityName,
      privacyMode,
      t,
    ],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
