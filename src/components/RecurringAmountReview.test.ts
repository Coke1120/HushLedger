import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import { formatMoneyForDisplay } from '../lib/privacy'
import { RecurringAmountReview } from './RecurringAmountReview'

const review = {
  latestGeneratedAmountMinor: 12_000,
  latestGeneratedDueOn: '2026-07-05',
  futureAmountMinor: 12_500,
}

function renderReview(privacyMode: boolean) {
  const context: I18nContextValue = {
    locale: 'en',
    setLocale: () => undefined,
    ledgerCurrency: 'HKD',
    setLedgerCurrency: () => undefined,
    privacyMode,
    setPrivacyMode: () => undefined,
    t: (key, values) => translate('en', key, values),
    formatMoney: (minor, currency = 'HKD') => (
      formatMoneyForDisplay(minor, currency, 'en', privacyMode)
    ),
    formatMonth: (month) => month,
    formatDate: (date) => date,
    formatNumber: String,
    localizeEntityName: (name) => name,
  }

  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(RecurringAmountReview, { currency: 'HKD', review }),
  ))
}

describe('recurring amount review', () => {
  it('shows a neutral comparison using the recorded due date and both amounts', () => {
    const markup = renderReview(false)

    assert.match(markup, /Recorded and future amounts differ/)
    assert.match(
      markup,
      /Latest generated entry \(2026-07-05\): HK\$120\.00\. Future rule: HK\$125\.00\./,
    )
    assert.match(markup, /Amounts can vary/)
    assert.match(markup, /A difference alone is not an error/)
    assert.doesNotMatch(markup, /overcharg|unusual|price increased|paid|payment due/i)
  })

  it('masks both comparison amounts under screen privacy', () => {
    const markup = renderReview(true)

    assert.equal(markup.match(/HK\$\u2022\u2022\u2022\u2022/g)?.length, 2)
    assert.doesNotMatch(markup, /120\.00|125\.00/)
  })
})
