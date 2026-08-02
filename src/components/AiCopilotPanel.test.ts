import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { createElement, createRef, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import type { SupportedCurrency } from '../lib/currency'
import { formatMoneyForDisplay } from '../lib/privacy'
import type { AiCopilotAction, AiCopilotContext, AiCopilotEvidence } from '../lib/aiCopilot'
import {
  AiCopilotActionList,
  AiCopilotContextPreview,
  AiCopilotEvidenceList,
  AiCopilotPanel,
  type AiCopilotPanelProps,
} from './AiCopilotPanel'
import { aiCopilotApprovalKey } from './aiCopilotApproval'

const messages: Record<string, string> = {
  aiCopilotTitle: 'Ledger copilot',
  aiCopilotHelp: 'Private guidance for this month.',
  aiCopilotClose: 'Close copilot',
  aiCopilotUnavailable: 'Copilot needs a live connection.',
  aiCopilotOpenAiImport: 'Import a statement',
  aiCopilotInsightsTitle: 'Needs attention',
  aiCopilotInsightsHelp: 'Deterministic checks from your ledger.',
  aiCopilotInsightsLoading: 'Checking this month…',
  aiCopilotInsightsEmpty: 'Nothing needs attention.',
  aiCopilotAskTitle: 'Ask about this month',
  aiCopilotAskHelp: 'Ask for an explanation or draft.',
  aiCopilotQuickPromptsLabel: 'Suggested questions',
  aiCopilotPromptReviewMonth: 'Review my month',
  aiCopilotPromptReduceSpending: 'Where could I spend less?',
  aiCopilotPromptUpcoming: 'What is coming up?',
  aiCopilotPromptLabel: 'Your question',
  aiCopilotPromptPlaceholder: 'Ask about your cash flow…',
  aiCopilotPrivacyNote: 'Your question and a limited ledger summary go to your configured provider.',
  aiCopilotAsk: 'Ask copilot',
  aiCopilotThinking: 'Thinking…',
  aiCopilotDraftLabel: 'Draft only — review before applying',
  aiCopilotActionShowTransactions: 'Review matching transactions',
  aiCopilotActionShowOverview: 'Open {section}',
  aiCopilotActionOpenRecurring: 'Review recurring items',
  aiCopilotActionOpenAiImport: 'Open AI statement import',
  aiCopilotActionDraftTransaction: 'Review transaction draft',
  aiCopilotActionDraftRecurringRule: 'Review recurring draft',
  aiConfigureFirst: 'Configure a provider before asking the copilot.',
  aiOpenSettings: 'Open Settings',
  netWorthTrendTitle: 'Net worth',
  retry: 'Retry',
}

const context: I18nContextValue = {
  locale: 'en',
  setLocale: () => undefined,
  ledgerCurrency: 'HKD',
  setLedgerCurrency: () => undefined,
  privacyMode: false,
  setPrivacyMode: () => undefined,
  t: (key, values = {}) => {
    const template = messages[key] ?? key
    return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (token, name: string) => (
      Object.hasOwn(values, name) ? String(values[name]) : token
    ))
  },
  formatMoney: (minor, currency = 'HKD') => formatMoneyForDisplay(
    minor,
    currency,
    'en',
    false,
  ),
  formatMonth: (month) => month,
  formatDate: (date) => date,
  formatNumber: String,
  localizeEntityName: (name) => name,
}

const previewContext: I18nContextValue = {
  ...context,
  t: (key, values) => translate('en', key, values),
}

function renderPanel(overrides: Partial<AiCopilotPanelProps> = {}) {
  const props: AiCopilotPanelProps = {
    month: '2026-08',
    settings: { baseUrl: '', apiKey: '', model: '' },
    persistedSettings: null,
    settingsConflict: false,
    persistedSettingsAvailable: true,
    available: true,
    panelRef: createRef<HTMLElement>(),
    onClose: () => undefined,
    onConfigure: () => undefined,
    onOpenAiImport: () => undefined,
    onAction: () => undefined,
    ...overrides,
  }
  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(AiCopilotPanel, props),
  ))
}

function renderActions(actions: readonly AiCopilotAction[]) {
  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(AiCopilotActionList, {
      actions,
      disabled: false,
      onAction: () => undefined,
    }),
  ))
}

const preview: AiCopilotContext = {
  month: '2026-08',
  currency: 'HKD',
  summary: { incomeMinor: 50_000, expenseMinor: 12_000, netMinor: 38_000 },
  expenseCategoryComparisons: [{
    categoryId: 3,
    categoryName: 'Food',
    amountMinor: 12_000,
    previousMonthAmountMinor: 9_000,
    transactionCount: 4,
  }],
  monthlySpendingPlans: [{
    categoryId: 3,
    categoryName: 'Food',
    plannedMinor: 10_000,
    spentMinor: 12_000,
  }],
  scheduledOutlook: {
    startOn: '2026-08-01',
    endOnExclusive: '2026-09-01',
    incomeMinor: 50_000,
    expenseMinor: 18_000,
    netMinor: 32_000,
  },
  attention: { duplicates: 1, unreviewed: 2, needsFollowUp: 3 },
  activeAccounts: [{ id: 1, name: 'Wallet', type: 'wallet', currency: 'HKD' }],
  activeCategories: [{ id: 3, name: 'Food', type: 'expense' }],
  omissionCounts: {
    expenseCategoryComparisons: 4,
    monthlySpendingPlans: 5,
    activeAccounts: 6,
    activeCategories: 7,
  },
}

const previewFormatting = {
  formatDate: previewContext.formatDate,
  formatMoney: previewContext.formatMoney,
  formatMonth: previewContext.formatMonth,
  formatNumber: previewContext.formatNumber,
  t: previewContext.t,
}

function renderPreviewElement(element: ReactElement) {
  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: previewContext },
    element,
  ))
}

describe('AI copilot panel', () => {
  it('renders its landmarks, privacy boundary, and configuration state', () => {
    const markup = renderPanel()

    assert.match(markup, /<section id="ai-copilot-panel"/)
    assert.match(markup, /<h3 id="ai-copilot-title">Ledger copilot<\/h3>/)
    assert.match(markup, /<h4 id="ai-copilot-insights-title">Needs attention<\/h4>/)
    assert.match(markup, /<h4 id="ai-copilot-ask-title">Ask about this month<\/h4>/)
    assert.match(markup, /Your question and a limited ledger summary go to your configured provider\./)
    assert.match(markup, /Configure a provider before asking the copilot\./)
    assert.match(markup, />Open Settings<\/button>/)
    assert.match(markup, /<textarea[^>]* disabled=""[^>]*><\/textarea>/)
    assert.match(markup, />Import a statement<\/button>/)
  })

  it('enables model prompts when transient provider settings are complete', () => {
    const markup = renderPanel({
      settings: {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'super-secret-provider-key',
        model: 'example-model',
      },
    })

    assert.doesNotMatch(markup, /Configure a provider before asking the copilot\./)
    assert.match(markup, /<textarea[^>]*><\/textarea>/)
    assert.doesNotMatch(markup, /<textarea[^>]* disabled=""/)
    assert.doesNotMatch(markup, /super-secret-provider-key/)
  })

  it('uses matching persisted provider metadata unless the settings are conflicted', () => {
    const persistedSettings = {
      baseUrl: 'https://api.example.com/v1',
      model: 'example-model',
      hasApiKey: true as const,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }
    const storedMarkup = renderPanel({
      settings: { baseUrl: persistedSettings.baseUrl, apiKey: '', model: persistedSettings.model },
      persistedSettings,
    })
    const conflictedMarkup = renderPanel({
      settings: { baseUrl: persistedSettings.baseUrl, apiKey: '', model: persistedSettings.model },
      persistedSettings,
      settingsConflict: true,
    })

    assert.doesNotMatch(storedMarkup, /Configure a provider before asking the copilot\./)
    assert.doesNotMatch(storedMarkup, /<textarea[^>]* disabled=""/)
    assert.match(conflictedMarkup, /Configure a provider before asking the copilot\./)
    assert.match(conflictedMarkup, /<textarea[^>]* disabled=""[^>]*><\/textarea>/)
  })

  it('labels every suggested operation as an explicit button and marks drafts', () => {
    const markup = renderActions([
      {
        type: 'show_transactions',
        filters: {
          transactionType: 'expense',
          categoryId: 3,
          importReviewStatus: 'all',
          duplicatesOnly: false,
          search: null,
        },
      },
      { type: 'show_overview', review: 'netWorth' },
      {
        type: 'draft_transaction',
        input: {
          id: '00000000-0000-4000-8000-000000000001',
          type: 'expense',
          amountMinor: 1_200,
          currency: 'HKD',
          accountId: 1,
          categoryId: 3,
          occurredOn: '2026-08-01',
          cleared: false,
          payee: 'Market',
          note: '',
        },
      },
      { type: 'open_ai_import' },
    ])

    assert.equal(markup.match(/<button/g)?.length, 4)
    assert.match(markup, />Review matching transactions</)
    assert.match(markup, />Open Net worth</)
    assert.match(markup, />Review transaction draft</)
    assert.match(markup, />Open AI statement import</)
    assert.equal(markup.match(/Draft only — review before applying/g)?.length, 1)
  })

  it('keeps provider reply text on React plain-text rendering paths', () => {
    const source = readFileSync(new URL('./AiCopilotPanel.tsx', import.meta.url), 'utf8')

    assert.match(source, /<p className="ai-copilot-reply">\{visibleResponse\.reply\}<\/p>/)
    assert.doesNotMatch(source, /dangerouslySetInnerHTML/)
  })

  it('invalidates approval when the month, provider identity, or context digest changes', () => {
    const provider = {
      source: 'stored' as const,
      baseUrl: 'https://api.example.com/v1',
      model: 'ledger-model',
      version: '2026-08-01T00:00:00.000Z',
    }
    const digest = 'a'.repeat(64)
    const approved = aiCopilotApprovalKey('2026-08', provider, digest)

    assert.equal(approved, aiCopilotApprovalKey('2026-08', provider, digest))
    assert.notEqual(approved, aiCopilotApprovalKey('2026-09', provider, digest))
    assert.notEqual(approved, aiCopilotApprovalKey('2026-08', { ...provider, model: 'new-model' }, digest))
    assert.notEqual(approved, aiCopilotApprovalKey('2026-08', provider, 'b'.repeat(64)))
  })

  it('previews provider identity and bounded context without API keys or raw transaction fields', () => {
    const markup = renderPreviewElement(createElement(AiCopilotContextPreview, {
        preview,
        provider: {
          source: 'transient',
          baseUrl: 'https://api.example.com/v1',
          model: 'ledger-model',
          version: 'unsaved',
        },
        formatting: previewFormatting,
      }))

    assert.match(markup, /https:\/\/api\.example\.com\/v1/)
    assert.match(markup, /ledger-model/)
    assert.match(markup, /2026-08-01/)
    assert.match(markup, /2026-09-01/)
    assert.match(markup, /Food \(ID 3\)/)
    assert.match(markup, /Wallet \(ID 1; type wallet; currency HKD\)/)
    assert.match(markup, /Category comparisons 4; spending plans 5; accounts 6; categories 7/)
    assert.match(markup, /Raw transactions, payees, and notes are excluded\./)
    assert.match(markup, /The API key is never shown here\./)
    assert.doesNotMatch(markup, /super-secret-provider-key/)
  })

  it('does not describe an unavailable provider as saved settings', () => {
    const markup = renderPreviewElement(createElement(AiCopilotContextPreview, {
      preview,
      provider: {
        source: 'unavailable',
        baseUrl: 'https://api.openai.com/v1',
        model: '',
        version: 'unavailable',
      },
      formatting: previewFormatting,
    }))

    assert.match(markup, /Provider: not configured/)
    assert.match(markup, /model: Not available/)
    assert.doesNotMatch(markup, /Provider: saved settings/)
  })

  it('uses privacy-aware money formatting and explains the limits of server-resolved evidence', () => {
    const privateFormatting = {
      ...previewFormatting,
      formatMoney: (minor: number, currency: SupportedCurrency = 'HKD') => formatMoneyForDisplay(
        minor,
        currency,
        'en',
        true,
      ),
    }
    const evidence: AiCopilotEvidence[] = [
      { kind: 'summary', month: '2026-08', currency: 'HKD', metric: 'net', amountMinor: 38_000 },
      {
        kind: 'attention',
        month: '2026-08',
        metric: 'duplicates',
        count: 1,
      },
    ]
    const previewMarkup = renderPreviewElement(createElement(AiCopilotContextPreview, {
      preview,
      provider: { source: 'stored', baseUrl: 'https://api.example.com/v1', model: 'm', version: 'v' },
      formatting: privateFormatting,
    }))
    const evidenceMarkup = renderPreviewElement(createElement(AiCopilotEvidenceList, {
      evidence,
      formatting: previewFormatting,
    }))
    const emptyEvidenceMarkup = renderPreviewElement(createElement(AiCopilotEvidenceList, {
      evidence: [],
      formatting: previewFormatting,
    }))

    assert.match(previewMarkup, /••••/)
    assert.doesNotMatch(previewMarkup, /500\.00|120\.00|380\.00/)
    assert.match(evidenceMarkup, /Ledger values referenced by AI/)
    assert.match(evidenceMarkup, /They support only the values shown, not every claim in the reply/)
    assert.match(evidenceMarkup, /Net for 2026-08/)
    assert.match(evidenceMarkup, /Possible duplicates for 2026-08: 1/)
    assert.match(emptyEvidenceMarkup, /They support only the values shown, not every claim in the reply/)
    assert.match(emptyEvidenceMarkup, /The AI did not reference any ledger values the server could resolve/)
  })

  it('binds requests and accepted replies to the reviewed context digest', () => {
    const source = readFileSync(new URL('./AiCopilotPanel.tsx', import.meta.url), 'utf8')

    assert.match(source, /expectedContextDigest: contextDigest/)
    assert.match(source, /parsed\.data\.contextDigest !== contextDigest/)
    assert.match(source, /AI_COPILOT_CONTEXT_CHANGED/)
    assert.match(source, /await loadInsights\(\)/)
  })
})
