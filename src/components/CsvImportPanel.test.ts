import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import type { CsvImportCommitResult } from '../lib/csvImport'
import { CsvImportCompletion, CsvImportPanel } from './CsvImportPanel'

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

const emptyResult: CsvImportCommitResult = {
  rows: [],
  ready: 0,
  matchable: 0,
  possibleDuplicates: 0,
  skipped: 0,
  blocked: 0,
  imported: 0,
  matched: 0,
  staleSkipped: 0,
}

function renderCompletion(result: CsvImportCommitResult | null, disabled = false) {
  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(CsvImportCompletion, {
      result,
      disabled,
      onReviewImports: () => undefined,
    }),
  ))
}

describe('CSV import completion', () => {
  it('offers review after adding rows or matching existing transactions', () => {
    for (const result of [
      { ...emptyResult, imported: 2 },
      { ...emptyResult, matched: 1 },
    ]) {
      const markup = renderCompletion(result)

      assert.match(markup, /<button[^>]*>Review unreviewed imports<\/button>/)
      assert.doesNotMatch(markup, /disabled=""/)
    }
  })

  it('does not offer a completion action before commit or when all rows were skipped', () => {
    assert.equal(renderCompletion(null), '')
    assert.equal(renderCompletion(emptyResult), '')
    assert.equal(renderCompletion({ ...emptyResult, staleSkipped: 3, skipped: 2 }), '')
  })

  it('keeps the review action unavailable while the panel is busy or unavailable', () => {
    assert.match(
      renderCompletion({ ...emptyResult, imported: 1 }, true),
      /<button[^>]*disabled=""[^>]*>Review unreviewed imports<\/button>/,
    )
  })

  it('starts with file selection and no premature completion action', () => {
    const markup = renderToStaticMarkup(createElement(
      I18nContext.Provider,
      { value: context },
      createElement(CsvImportPanel, {
        accounts: [],
        categories: [],
        available: false,
        panelRef: { current: null },
        onClose: () => undefined,
        onImported: async () => undefined,
        onReviewImports: () => undefined,
        onMutationStateChange: () => undefined,
      }),
    ))

    assert.match(markup, /type="file"[^>]*disabled=""/)
    assert.doesNotMatch(markup, /Review unreviewed imports/)
  })
})
