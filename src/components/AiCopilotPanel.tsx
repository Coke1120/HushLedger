'use client'

import {
  Bot,
  CircleAlert,
  Lightbulb,
  LoaderCircle,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  message,
  messageForError,
  renderMessage,
  useI18n,
  type LocalizedMessage,
  type MessageKey,
} from '../i18n'
import type { I18nContextValue } from '../i18n/context'
import {
  aiProviderSettingsSchema,
  type AiProviderSettings,
  type AiProviderSettingsRow,
} from '../lib/ai'
import {
  MAX_AI_COPILOT_PROMPT_LENGTH,
  aiCopilotInsightsResponseSchema,
  aiCopilotResponseSchema,
  type AiCopilotAction,
  type AiCopilotContext,
  type AiCopilotContextCoverage,
  type AiCopilotEvidence,
  type AiCopilotInsight,
  type AiCopilotResponse,
  type AiCopilotSummaryMetric,
} from '../lib/aiCopilot'
import { api, ApiError } from '../lib/api'
import {
  aiCopilotApprovalKey,
  type AiCopilotProviderIdentity,
} from './aiCopilotApproval'

export type AiCopilotPanelProps = {
  month: string
  settings: AiProviderSettings
  persistedSettings: AiProviderSettingsRow | null
  settingsConflict: boolean
  persistedSettingsAvailable: boolean
  available: boolean
  panelRef: RefObject<HTMLElement | null>
  onClose: () => void
  onConfigure: () => void
  onOpenAiImport: () => void
  onAction: (action: AiCopilotAction) => void
}

type AiCopilotActionListProps = {
  actions: readonly AiCopilotAction[]
  disabled: boolean
  onAction: (action: AiCopilotAction) => void
}

type InsightFormatting = Pick<I18nContextValue, 'formatMoney' | 'formatNumber' | 't'>
type PreviewFormatting = Pick<
  I18nContextValue,
  'formatDate' | 'formatMoney' | 'formatMonth' | 'formatNumber' | 't'
>

export function AiCopilotActionList({
  actions,
  disabled,
  onAction,
}: AiCopilotActionListProps) {
  const { t } = useI18n()

  return (
    <div className="ai-copilot-action-list">
      {actions.map((action, index) => {
        const isDraft = action.type === 'draft_transaction'
          || action.type === 'draft_recurring_rule'
        return (
          <button
            className={`ai-copilot-action${isDraft ? ' is-draft' : ''}`}
            type="button"
            key={`${action.type}-${index}`}
            onClick={() => onAction(action)}
            disabled={disabled}
          >
            {isDraft ? <Lightbulb aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
            <span className="ai-copilot-action-copy">
              <span>{actionLabel(action, t)}</span>
              {isDraft ? <small>{t('aiCopilotDraftLabel')}</small> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function AiCopilotPanel({
  month,
  settings,
  persistedSettings,
  settingsConflict,
  persistedSettingsAvailable,
  available,
  panelRef,
  onClose,
  onConfigure,
  onOpenAiImport,
  onAction,
}: AiCopilotPanelProps) {
  const { formatDate, formatMoney, formatMonth, formatNumber, locale, t } = useI18n()
  const [insights, setInsights] = useState<AiCopilotInsight[]>([])
  const [insightsLoading, setInsightsLoading] = useState(available)
  const [insightsError, setInsightsError] = useState<LocalizedMessage | null>(null)
  const [contextCoverage, setContextCoverage] = useState<AiCopilotContextCoverage | null>(null)
  const [preview, setPreview] = useState<AiCopilotContext | null>(null)
  const [contextDigest, setContextDigest] = useState<string | null>(null)
  const [approvedContextKey, setApprovedContextKey] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState<{ month: string; data: AiCopilotResponse } | null>(null)
  const [asking, setAsking] = useState(false)
  const [requestError, setRequestError] = useState<LocalizedMessage | null>(null)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const insightsRequestIdRef = useRef(0)
  const insightsControllerRef = useRef<AbortController | null>(null)
  const replyRequestIdRef = useRef(0)
  const replyControllerRef = useRef<AbortController | null>(null)

  const transientProvider = aiProviderSettingsSchema.safeParse(settings)
  const canUseStoredProvider = !settings.apiKey.trim()
    && persistedSettingsAvailable
    && !settingsConflict
    && persistedSettings?.hasApiKey === true
    && settings.baseUrl.trim() === persistedSettings.baseUrl
    && settings.model.trim() === persistedSettings.model
  const configured = transientProvider.success || canUseStoredProvider
  const providerIdentity: AiCopilotProviderIdentity = transientProvider.success
    ? {
        source: 'transient',
        baseUrl: transientProvider.data.baseUrl,
        model: transientProvider.data.model,
        version: 'unsaved',
      }
    : canUseStoredProvider ? {
        source: 'stored',
        baseUrl: settings.baseUrl.trim(),
        model: settings.model.trim(),
        version: persistedSettings!.updatedAt,
      } : {
        source: 'unavailable',
        baseUrl: settings.baseUrl.trim(),
        model: settings.model.trim(),
        version: 'unavailable',
      }
  const currentApprovalKey = contextDigest
    ? aiCopilotApprovalKey(month, providerIdentity, contextDigest)
    : null
  const contextApproved = currentApprovalKey !== null && approvedContextKey === currentApprovalKey
  const busy = asking
  const visibleResponse = response?.month === month ? response.data : null
  const contextPartial = visibleResponse?.context.partial ?? contextCoverage?.partial ?? false

  const loadInsights = useCallback(async () => {
    if (!available) return

    setInsightsLoading(true)
    setInsightsError(null)
    setContextCoverage(null)
    setPreview(null)
    setContextDigest(null)
    const requestId = ++insightsRequestIdRef.current
    insightsControllerRef.current?.abort()
    const controller = new AbortController()
    insightsControllerRef.current = controller
    try {
      const result = await api<unknown>(
        `/api/ai/copilot?month=${encodeURIComponent(month)}`,
        { signal: controller.signal },
      )
      if (controller.signal.aborted || requestId !== insightsRequestIdRef.current) return
      const parsed = aiCopilotInsightsResponseSchema.safeParse(result)
      if (!parsed.success) throw new Error('Invalid AI copilot insights')
      setInsights(parsed.data.insights)
      setContextCoverage(parsed.data.context)
      setPreview(parsed.data.preview)
      setContextDigest(parsed.data.contextDigest)
    } catch (caught) {
      if (controller.signal.aborted || requestId !== insightsRequestIdRef.current) return
      setInsightsError(messageForError(caught, 'aiCopilotInsightsFailed'))
    } finally {
      if (requestId === insightsRequestIdRef.current) {
        insightsControllerRef.current = null
        setInsightsLoading(false)
      }
    }
  }, [available, month])

  useEffect(() => {
    if (!available) return
    const timeout = window.setTimeout(() => void loadInsights(), 0)
    return () => {
      window.clearTimeout(timeout)
      insightsRequestIdRef.current += 1
      insightsControllerRef.current?.abort()
      insightsControllerRef.current = null
    }
  }, [available, loadInsights])

  useEffect(() => {
    replyRequestIdRef.current += 1
    replyControllerRef.current?.abort()
    replyControllerRef.current = null
    const timeout = window.setTimeout(() => {
      setAsking(false)
      setRequestError(null)
    }, 0)
    return () => {
      window.clearTimeout(timeout)
      replyRequestIdRef.current += 1
      replyControllerRef.current?.abort()
      replyControllerRef.current = null
    }
  }, [month])

  useEffect(() => {
    if (available) return
    insightsRequestIdRef.current += 1
    insightsControllerRef.current?.abort()
    insightsControllerRef.current = null
    replyRequestIdRef.current += 1
    replyControllerRef.current?.abort()
    replyControllerRef.current = null
    const timeout = window.setTimeout(() => {
      setInsightsLoading(false)
      setAsking(false)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [available])

  useEffect(() => () => {
    insightsRequestIdRef.current += 1
    insightsControllerRef.current?.abort()
    replyRequestIdRef.current += 1
    replyControllerRef.current?.abort()
  }, [])

  const chooseQuickPrompt = (messageKey: MessageKey) => {
    if (busy || !available || !configured) return
    setPrompt(t(messageKey))
    promptRef.current?.focus()
  }

  const askCopilot = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (asking) return
    setRequestError(null)

    const parsedTransientProvider = aiProviderSettingsSchema.safeParse(settings)
    if (!parsedTransientProvider.success && !canUseStoredProvider) {
      setRequestError(message('aiConfigureFirst'))
      return
    }
    if (!available) {
      setRequestError(message('aiOffline'))
      return
    }

    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) return
    if (!contextApproved || !contextDigest) {
      setRequestError(message('aiCopilotReviewRequired'))
      return
    }
    const provider = parsedTransientProvider.success
      ? { source: 'transient' as const, ...parsedTransientProvider.data }
      : { source: 'stored' as const, expectedUpdatedAt: persistedSettings!.updatedAt }

    setAsking(true)
    setResponse(null)
    const requestId = ++replyRequestIdRef.current
    replyControllerRef.current?.abort()
    const controller = new AbortController()
    replyControllerRef.current = controller
    try {
      const result = await api<unknown>('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          locale,
          month,
          expectedContextDigest: contextDigest,
          prompt: trimmedPrompt,
        }),
        signal: controller.signal,
      })
      if (controller.signal.aborted || requestId !== replyRequestIdRef.current) return
      const parsed = aiCopilotResponseSchema.safeParse(result)
      if (!parsed.success) throw new Error('Invalid AI copilot response')
      if (parsed.data.contextDigest !== contextDigest) {
        throw new Error('AI copilot response context did not match the reviewed context')
      }
      setResponse({ month, data: parsed.data })
    } catch (caught) {
      if (controller.signal.aborted || requestId !== replyRequestIdRef.current) return
      if (caught instanceof ApiError && caught.code === 'AI_COPILOT_CONTEXT_CHANGED') {
        setRequestError(message('aiCopilotContextChanged'))
        await loadInsights()
        return
      }
      setRequestError(messageForError(caught, 'aiCopilotRequestFailed'))
    } finally {
      if (requestId === replyRequestIdRef.current) {
        replyControllerRef.current = null
        setAsking(false)
      }
    }
  }

  return (
    <section
      id="ai-copilot-panel"
      className="ai-copilot-panel"
      aria-labelledby="ai-copilot-title"
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="ai-copilot-heading">
        <div className="ai-copilot-heading-copy">
          <span className="ai-copilot-mark" aria-hidden="true">
            <Bot />
          </span>
          <div>
            <h3 id="ai-copilot-title">{t('aiCopilotTitle')}</h3>
            <p>{t('aiCopilotHelp')}</p>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label={t('aiCopilotClose')}
        >
          <X aria-hidden="true" />
        </button>
      </div>

      {!available ? (
        <div className="ai-copilot-availability" role="status">
          <CircleAlert aria-hidden="true" />
          <span>{t('aiCopilotUnavailable')}</span>
        </div>
      ) : null}

      {!configured ? (
        <div className="ai-configure-notice">
          <p>{t('aiConfigureFirst')}</p>
          <button className="button button-secondary" type="button" onClick={onConfigure}>
            {t('aiOpenSettings')}
          </button>
        </div>
      ) : null}

      {contextPartial ? (
        <div className="ai-copilot-availability" role="status">
          <CircleAlert aria-hidden="true" />
          <span>{t('aiCopilotPartialContext')}</span>
        </div>
      ) : null}

      <section className="ai-copilot-insights" aria-labelledby="ai-copilot-insights-title">
        <div className="ai-copilot-section-heading">
          <div>
            <h4 id="ai-copilot-insights-title">{t('aiCopilotInsightsTitle')}</h4>
            <p>{t('aiCopilotInsightsHelp')}</p>
          </div>
          <button
            className="button button-secondary ai-copilot-import-shortcut"
            type="button"
            onClick={onOpenAiImport}
            disabled={busy || !available}
          >
            <Upload aria-hidden="true" />
            {t('aiCopilotOpenAiImport')}
          </button>
        </div>

        {insightsLoading ? (
          <p className="ai-copilot-loading" role="status">
            <LoaderCircle className="spin" aria-hidden="true" />
            {t('aiCopilotInsightsLoading')}
          </p>
        ) : null}
        {!insightsLoading && insightsError ? (
          <div className="ai-copilot-inline-error">
            <p className="form-error" role="alert">{renderMessage(t, insightsError)}</p>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void loadInsights()}
              disabled={!available}
            >
              {t('retry')}
            </button>
          </div>
        ) : null}
        {!insightsLoading && !insightsError && insights.length === 0 ? (
          <p className="ai-copilot-empty">{t('aiCopilotInsightsEmpty')}</p>
        ) : null}
        {insights.length > 0 ? (
          <div className="ai-copilot-insight-list">
            {insights.map((insight) => {
              const copy = insightCopy(insight, { formatMoney, formatNumber, t })
              return (
                <article
                  className={`ai-copilot-insight is-${insight.severity}`}
                  key={insightKey(insight)}
                >
                  <span className="ai-copilot-insight-icon" aria-hidden="true">
                    <CircleAlert />
                  </span>
                  <div>
                    <h5>{copy.title}</h5>
                    <p>{copy.body}</p>
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => onAction(insight.action)}
                      disabled={busy || !available}
                    >
                      {t('aiCopilotReviewInsight')}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : null}
      </section>

      <section className="ai-copilot-conversation" aria-labelledby="ai-copilot-ask-title">
        <div className="ai-copilot-section-heading">
          <div>
            <h4 id="ai-copilot-ask-title">{t('aiCopilotAskTitle')}</h4>
            <p>{t('aiCopilotAskHelp')}</p>
          </div>
        </div>

        <div
          className="ai-copilot-quick-prompts"
          role="group"
          aria-label={t('aiCopilotQuickPromptsLabel')}
        >
          {([
            'aiCopilotPromptReviewMonth',
            'aiCopilotPromptReduceSpending',
            'aiCopilotPromptUpcoming',
          ] as const).map((messageKey) => (
            <button
              type="button"
              key={messageKey}
              onClick={() => chooseQuickPrompt(messageKey)}
              disabled={busy || !available || !configured}
            >
              {t(messageKey)}
            </button>
          ))}
        </div>

        <form className="ai-copilot-form" onSubmit={askCopilot} noValidate>
          <label htmlFor="ai-copilot-prompt">{t('aiCopilotPromptLabel')}</label>
          <textarea
            id="ai-copilot-prompt"
            ref={promptRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
            maxLength={MAX_AI_COPILOT_PROMPT_LENGTH}
            placeholder={t('aiCopilotPromptPlaceholder')}
            autoComplete="off"
            aria-describedby="ai-copilot-privacy-note"
            disabled={asking || !available || !configured}
            required
          />

          {preview && contextDigest ? (
            <AiCopilotContextPreview
              preview={preview}
              provider={providerIdentity}
              formatting={{ formatDate, formatMoney, formatMonth, formatNumber, t }}
            />
          ) : null}

          <label className="ai-copilot-review-toggle">
            <input
              type="checkbox"
              checked={contextApproved}
              onChange={(event) => setApprovedContextKey(
                event.target.checked ? currentApprovalKey : null,
              )}
              disabled={asking || !available || !configured || currentApprovalKey === null}
            />
            <span>{t('aiCopilotReviewAcknowledgement')}</span>
          </label>

          <div className="ai-copilot-form-footer">
            <div className="ai-copilot-privacy-note" id="ai-copilot-privacy-note">
              <ShieldCheck aria-hidden="true" />
              <span>{t('aiCopilotPrivacyNote')}</span>
            </div>
            <button
              className="button button-primary"
              type="submit"
              disabled={asking || !available || !configured || !prompt.trim() || !contextApproved}
            >
              {asking
                ? <LoaderCircle className="spin" aria-hidden="true" />
                : <Send aria-hidden="true" />}
              {asking ? t('aiCopilotThinking') : t('aiCopilotAsk')}
            </button>
          </div>
        </form>

        {requestError ? (
          <p className="form-error" role="alert">{renderMessage(t, requestError)}</p>
        ) : null}

        {visibleResponse ? (
          <div className="ai-copilot-response" aria-live="polite">
            <div className="ai-copilot-response-heading">
              <Sparkles aria-hidden="true" />
              <h5>{t('aiCopilotReplyTitle')}</h5>
            </div>
            <p className="ai-copilot-reply">{visibleResponse.reply}</p>
            <AiCopilotEvidenceList
              evidence={visibleResponse.evidence}
              formatting={{ formatDate, formatMoney, formatMonth, formatNumber, t }}
            />
            {visibleResponse.actions.length > 0 ? (
              <div className="ai-copilot-response-actions">
                <h6>{t('aiCopilotActionsTitle')}</h6>
                <p>{t('aiCopilotActionsHelp')}</p>
                <AiCopilotActionList
                  actions={visibleResponse.actions}
                  disabled={asking || !available}
                  onAction={onAction}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </section>
  )
}

export function AiCopilotContextPreview({
  preview,
  provider,
  formatting,
}: {
  preview: AiCopilotContext
  provider: AiCopilotProviderIdentity
  formatting: PreviewFormatting
}) {
  const { formatDate, formatMoney, formatMonth, formatNumber, t } = formatting
  const omissionTotal = Object.values(preview.omissionCounts)
    .reduce((total, count) => total + count, 0)

  return (
    <details className="ai-copilot-preview">
      <summary>{t('aiCopilotPreviewTitle')}</summary>
      <div className="ai-copilot-preview-content">
        <p>{t('aiCopilotPreviewProvider', {
          source: t(providerSourceMessageKey(provider.source)),
          baseUrl: provider.baseUrl || t('aiCopilotNotAvailable'),
          model: provider.model || t('aiCopilotNotAvailable'),
        })}</p>
        <p>{t('aiCopilotPreviewMonth', { month: formatMonth(preview.month) })}</p>
        <PreviewGroup title={t('aiCopilotPreviewSummary')}>
          <li>{t('aiCopilotPreviewIncome', { amount: formatMoney(preview.summary.incomeMinor, preview.currency) })}</li>
          <li>{t('aiCopilotPreviewExpense', { amount: formatMoney(preview.summary.expenseMinor, preview.currency) })}</li>
          <li>{t('aiCopilotPreviewNet', { amount: formatMoney(preview.summary.netMinor, preview.currency) })}</li>
        </PreviewGroup>
        <PreviewGroup title={t('aiCopilotPreviewScheduled')}>
          <li>{t('aiCopilotPreviewScheduledTotals', {
            start: formatDate(preview.scheduledOutlook.startOn),
            end: formatDate(preview.scheduledOutlook.endOnExclusive),
            income: formatMoney(preview.scheduledOutlook.incomeMinor, preview.currency),
            expense: formatMoney(preview.scheduledOutlook.expenseMinor, preview.currency),
            net: formatMoney(preview.scheduledOutlook.netMinor, preview.currency),
          })}</li>
        </PreviewGroup>
        <PreviewGroup title={t('aiCopilotPreviewCategoryComparisons')} empty={preview.expenseCategoryComparisons.length === 0}>
          {preview.expenseCategoryComparisons.map((item) => (
            <li key={item.categoryId}>{t('aiCopilotPreviewCategoryComparison', {
              name: item.categoryName,
              id: item.categoryId,
              amount: formatMoney(item.amountMinor, preview.currency),
              previous: item.previousMonthAmountMinor === null
                ? t('aiCopilotNotAvailable')
                : formatMoney(item.previousMonthAmountMinor, preview.currency),
              count: formatNumber(item.transactionCount),
            })}</li>
          ))}
        </PreviewGroup>
        <PreviewGroup title={t('aiCopilotPreviewPlans')} empty={preview.monthlySpendingPlans.length === 0}>
          {preview.monthlySpendingPlans.map((item) => (
            <li key={item.categoryId}>{t('aiCopilotPreviewPlan', {
              name: item.categoryName,
              id: item.categoryId,
              planned: formatMoney(item.plannedMinor, preview.currency),
              spent: formatMoney(item.spentMinor, preview.currency),
            })}</li>
          ))}
        </PreviewGroup>
        <PreviewGroup title={t('aiCopilotPreviewAttention')}>
          <li>{t('aiCopilotPreviewAttentionCounts', {
            duplicates: formatNumber(preview.attention.duplicates),
            unreviewed: formatNumber(preview.attention.unreviewed),
            needsFollowUp: formatNumber(preview.attention.needsFollowUp),
          })}</li>
        </PreviewGroup>
        <PreviewGroup title={t('aiCopilotPreviewAccounts')} empty={preview.activeAccounts.length === 0}>
          {preview.activeAccounts.map((account) => (
            <li key={account.id}>{t('aiCopilotPreviewAccount', {
              name: account.name,
              id: account.id,
              type: account.type,
              currency: account.currency,
            })}</li>
          ))}
        </PreviewGroup>
        <PreviewGroup title={t('aiCopilotPreviewCategories')} empty={preview.activeCategories.length === 0}>
          {preview.activeCategories.map((category) => (
            <li key={category.id}>{t('aiCopilotPreviewCategory', {
              name: category.name,
              id: category.id,
              type: category.type,
            })}</li>
          ))}
        </PreviewGroup>
        <PreviewGroup title={t('aiCopilotPreviewOmissions', { count: formatNumber(omissionTotal) })}>
          <li>{t('aiCopilotPreviewOmissionCounts', {
            comparisons: formatNumber(preview.omissionCounts.expenseCategoryComparisons),
            plans: formatNumber(preview.omissionCounts.monthlySpendingPlans),
            accounts: formatNumber(preview.omissionCounts.activeAccounts),
            categories: formatNumber(preview.omissionCounts.activeCategories),
          })}</li>
        </PreviewGroup>
        <p className="ai-copilot-preview-excluded">{t('aiCopilotPreviewExcluded')}</p>
      </div>
    </details>
  )
}

function providerSourceMessageKey(
  source: AiCopilotProviderIdentity['source'],
): MessageKey {
  switch (source) {
    case 'stored': return 'aiCopilotProviderStored'
    case 'transient': return 'aiCopilotProviderTransient'
    case 'unavailable': return 'aiCopilotProviderUnavailable'
  }
}

function PreviewGroup({
  title,
  empty = false,
  children,
}: {
  title: string
  empty?: boolean
  children: ReactNode
}) {
  const { t } = useI18n()
  return (
    <section>
      <h5>{title}</h5>
      <ul>{empty ? <li>{t('aiCopilotPreviewNone')}</li> : children}</ul>
    </section>
  )
}

export function AiCopilotEvidenceList({
  evidence,
  formatting,
}: {
  evidence: readonly AiCopilotEvidence[]
  formatting: PreviewFormatting
}) {
  const { t } = formatting
  return (
    <section className="ai-copilot-evidence" aria-labelledby="ai-copilot-evidence-title">
      <h6 id="ai-copilot-evidence-title">{t('aiCopilotEvidenceTitle')}</h6>
      <p>{t('aiCopilotEvidenceHelp')}</p>
      {evidence.length > 0 ? (
        <ul>
          {evidence.map((item, index) => (
            <li key={`${item.kind}-${index}`}>{evidenceCopy(item, formatting)}</li>
          ))}
        </ul>
      ) : <p>{t('aiCopilotEvidenceEmpty')}</p>}
    </section>
  )
}

function evidenceCopy(evidence: AiCopilotEvidence, formatting: PreviewFormatting) {
  const { formatDate, formatMoney, formatMonth, formatNumber, t } = formatting
  switch (evidence.kind) {
    case 'summary':
      return t('aiCopilotEvidenceSummary', {
        month: formatMonth(evidence.month),
        metric: t(summaryMetricMessageKey(evidence.metric)),
        amount: formatMoney(evidence.amountMinor, evidence.currency),
      })
    case 'category_comparison':
      return t('aiCopilotEvidenceCategoryComparison', {
        month: formatMonth(evidence.month),
        category: evidence.categoryName,
        amount: formatMoney(evidence.amountMinor, evidence.currency),
        previous: evidence.previousMonthAmountMinor === null
          ? t('aiCopilotNotAvailable')
          : formatMoney(evidence.previousMonthAmountMinor, evidence.currency),
        count: formatNumber(evidence.transactionCount),
      })
    case 'monthly_plan':
      return t('aiCopilotEvidencePlan', {
        month: formatMonth(evidence.month),
        category: evidence.categoryName,
        planned: formatMoney(evidence.plannedMinor, evidence.currency),
        spent: formatMoney(evidence.spentMinor, evidence.currency),
      })
    case 'scheduled_outlook':
      return t('aiCopilotEvidenceScheduled', {
        start: formatDate(evidence.startOn),
        end: formatDate(evidence.endOnExclusive),
        income: formatMoney(evidence.incomeMinor, evidence.currency),
        expense: formatMoney(evidence.expenseMinor, evidence.currency),
        net: formatMoney(evidence.netMinor, evidence.currency),
      })
    case 'attention':
      return t('aiCopilotEvidenceAttention', {
        month: formatMonth(evidence.month),
        metric: t(attentionMetricMessageKey(evidence.metric)),
        count: formatNumber(evidence.count),
      })
  }
}

function summaryMetricMessageKey(metric: AiCopilotSummaryMetric): MessageKey {
  switch (metric) {
    case 'income': return 'income'
    case 'expense': return 'expense'
    case 'net': return 'aiCopilotMetricNet'
  }
}

function attentionMetricMessageKey(
  metric: Extract<AiCopilotEvidence, { kind: 'attention' }>['metric'],
): MessageKey {
  switch (metric) {
    case 'duplicates': return 'aiCopilotMetricDuplicates'
    case 'unreviewed': return 'aiCopilotMetricUnreviewed'
    case 'needs_follow_up': return 'aiCopilotMetricNeedsFollowUp'
  }
}

function insightKey(insight: AiCopilotInsight) {
  if (insight.kind === 'over_plan' || insight.kind === 'spending_increase') {
    return `${insight.kind}-${insight.categoryId}`
  }
  return insight.kind
}

function insightCopy(insight: AiCopilotInsight, formatting: InsightFormatting) {
  const { formatMoney, formatNumber, t } = formatting
  switch (insight.kind) {
    case 'duplicates':
      return {
        title: t('aiCopilotInsightDuplicatesTitle'),
        body: t('aiCopilotInsightDuplicatesBody', { count: insight.count }),
      }
    case 'import_attention':
      return {
        title: t('aiCopilotInsightImportAttentionTitle'),
        body: t('aiCopilotInsightImportAttentionBody', {
          unreviewed: insight.unreviewed,
          needsFollowUp: insight.needsFollowUp,
        }),
      }
    case 'over_plan':
      return {
        title: t('aiCopilotInsightOverPlanTitle'),
        body: t('aiCopilotInsightOverPlanBody', {
          category: insight.categoryName,
          planned: formatMoney(insight.plannedMinor),
          spent: formatMoney(insight.spentMinor),
          overBy: formatMoney(insight.overByMinor),
        }),
      }
    case 'spending_increase':
      return {
        title: t('aiCopilotInsightSpendingIncreaseTitle'),
        body: t('aiCopilotInsightSpendingIncreaseBody', {
          category: insight.categoryName,
          amount: formatMoney(insight.amountMinor),
          previous: formatMoney(insight.previousMonthAmountMinor),
          increase: formatMoney(insight.increaseMinor),
          percent: formatNumber(insight.increaseBasisPoints / 100),
        }),
      }
    case 'scheduled_deficit':
      return {
        title: t('aiCopilotInsightScheduledDeficitTitle'),
        body: t('aiCopilotInsightScheduledDeficitBody', {
          income: formatMoney(insight.incomeMinor),
          expense: formatMoney(insight.expenseMinor),
          deficit: formatMoney(insight.deficitMinor),
        }),
      }
  }
}

function actionLabel(action: AiCopilotAction, t: I18nContextValue['t']) {
  if (action.type === 'show_overview') {
    return t('aiCopilotActionShowOverview', {
      section: t(overviewReviewMessageKey(action.review)),
    })
  }
  return t(actionMessageKey(action))
}

function actionMessageKey(
  action: Exclude<AiCopilotAction, { type: 'show_overview' }>,
): MessageKey {
  switch (action.type) {
    case 'show_transactions': return 'aiCopilotActionShowTransactions'
    case 'open_recurring': return 'aiCopilotActionOpenRecurring'
    case 'open_ai_import': return 'aiCopilotActionOpenAiImport'
    case 'draft_transaction': return 'aiCopilotActionDraftTransaction'
    case 'draft_recurring_rule': return 'aiCopilotActionDraftRecurringRule'
  }
}

function overviewReviewMessageKey(
  review: Extract<AiCopilotAction, { type: 'show_overview' }>['review'],
): MessageKey {
  switch (review) {
    case 'netWorth': return 'netWorthTrendTitle'
    case 'cashFlow': return 'cashFlowTrend'
    case 'income': return 'incomeSourcesTitle'
    case 'spending': return 'spendingBreakdown'
    case 'plans': return 'monthlyPlansTitle'
    case 'outlook': return 'scheduledOutlookTitle'
  }
}
