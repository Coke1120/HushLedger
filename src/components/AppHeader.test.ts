import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import { AppHeader } from './AppHeader'

const context: I18nContextValue = {
  locale: 'en',
  setLocale: () => undefined,
  ledgerCurrency: 'HKD',
  setLedgerCurrency: () => undefined,
  privacyMode: false,
  setPrivacyMode: () => undefined,
  t: (key, values) => translate('en', key, values),
  formatMoney: (minor, currency = 'HKD') =>
    formatMoneyForDisplay(minor, currency, 'en', false),
  formatMonth: (month) => month,
  formatDate: (date) => date,
  formatNumber: String,
  localizeEntityName: (name) => name,
}

function renderHeader(aiStatementImportConfigured: boolean, aiStatementImportOpen = false) {
  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(AppHeader, {
      view: 'transactions',
      navigationDisabled: false,
      addDisabled: false,
      aiStatementImportConfigured,
      aiStatementImportOpen,
      onAdd: () => undefined,
      onAiStatementImport: () => undefined,
      onViewChange: () => undefined,
    }),
  ))
}

describe('header transaction entry', () => {
  it('makes the configured statement textarea flow primary while retaining manual entry', () => {
    const markup = renderHeader(true, true)
    const importIndex = markup.indexOf('header-ai-import-button')
    const manualIndex = markup.indexOf('class="icon-button add-button"')

    assert.ok(importIndex >= 0 && importIndex < manualIndex)
    assert.match(
      markup,
      /header-ai-import-button[^>]*aria-expanded="true"[^>]*aria-controls="bank-import-panel"/,
    )
    assert.match(markup, />Paste bank \/ card transactions<\/span><\/button>/)
    assert.match(markup, /class="icon-button add-button"[^>]*aria-label="Add transaction"/)
  })

  it('disables AI import until provider settings are usable without disabling manual entry', () => {
    const markup = renderHeader(false)

    assert.match(
      markup,
      /header-ai-import-button[^>]*disabled=""[^>]*aria-describedby="header-ai-import-unavailable"[^>]*title="Save the AI provider settings/,
    )
    assert.match(markup, /id="header-ai-import-unavailable">Save the AI provider settings/)
    assert.doesNotMatch(markup, /class="icon-button add-button"[^>]*disabled=""/)
  })
})
