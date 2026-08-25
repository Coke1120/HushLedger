import { loadLocale, supportedLocales } from '../src/i18n/core'

await Promise.all(supportedLocales.map((locale) => loadLocale(locale)))
