import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { LedgerBackupReminder } from './LedgerBackupReminder'

const context: I18nContextValue = {
  locale: 'en',
  setLocale: () => undefined,
  ledgerCurrency: 'HKD',
  setLedgerCurrency: () => undefined,
  privacyMode: false,
  setPrivacyMode: () => undefined,
  t: (key, values) => translate('en', key, values),
  formatMoney: String,
  formatMonth: String,
  formatDate: String,
  formatNumber: String,
  localizeEntityName: (name) => name,
}

function renderReminder(due: boolean | null, live = true, disabled = false) {
  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(LedgerBackupReminder, {
      due,
      live,
      disabled,
      onReview: () => undefined,
    }),
  ))
}

describe('overview ledger backup reminder', () => {
  it('waits for browser-local health and a live ledger before rendering', () => {
    assert.equal(renderReminder(null), '')
    assert.equal(renderReminder(false), '')
    assert.equal(renderReminder(true, false), '')
  })

  it('describes only the missing browser record without claiming a backup is lost', () => {
    const markup = renderReminder(true)

    assert.match(markup, /Keep a recent ledger copy/)
    assert.match(
      markup,
      /This browser has no record of HushLedger preparing a ledger download in the last 30 days\./,
    )
    assert.match(markup, /It cannot tell whether another copy exists or can be restored\./)
    assert.match(markup, /Review backup settings/)
    assert.doesNotMatch(markup, /no backup|backup is missing|safe backup|verified backup/i)
    assert.doesNotMatch(markup, /<time/)
  })

  it('keeps the settings action unavailable during a ledger critical section', () => {
    assert.match(renderReminder(true, true, true), /<button[^>]*disabled=""/)
  })
})
