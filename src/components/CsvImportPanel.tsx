import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Link2,
  LoaderCircle,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import { messageForError, renderMessage, useI18n, type MessageKey } from '../i18n'
import { ApiError, api } from '../lib/api'
import {
  detectBankCsvDelimiter,
  parseBankCsvDocument,
  type BankCsvDelimiter,
  type BankCsvDocument,
} from '../lib/bankCsvImport'
import {
  MAX_CSV_IMPORT_BYTES,
  csvImportCommitResultSchema,
  csvImportPreviewResultSchema,
  parseHushLedgerCsv,
  recategorizeCsvImportReview,
  type CsvImportCommitResult,
  type CsvImportIssue,
  type CsvImportIssueCode,
  type CsvImportPreviewResult,
  type CsvImportRow,
  type CsvImportRowStatus,
} from '../lib/csvImport'
import type { Account, Category, PayeeSuggestion } from '../lib/schema'
import { BankCsvMappingForm } from './BankCsvMappingForm'

type CsvImportPanelProps = {
  accounts: Account[]
  categories: Category[]
  available: boolean
  panelRef: RefObject<HTMLElement | null>
  onClose: () => void
  onImported: () => Promise<unknown>
  onReviewImports: (status: 'unreviewed') => void
  onMutationStateChange: (mutating: boolean) => void
}

export function CsvImportPanel({
  accounts,
  categories,
  available,
  panelRef,
  onClose,
  onImported,
  onReviewImports,
  onMutationStateChange,
}: CsvImportPanelProps) {
  const { formatDate, formatMoney, localizeEntityName, t } = useI18n()
  const [fileName, setFileName] = useState('')
  const [fileText, setFileText] = useState('')
  const [bankDocument, setBankDocument] = useState<BankCsvDocument | null>(null)
  const [rows, setRows] = useState<CsvImportRow[]>([])
  const [preview, setPreview] = useState<CsvImportPreviewResult | null>(null)
  const [issues, setIssues] = useState<CsvImportIssue[]>([])
  const [payeeSuggestions, setPayeeSuggestions] = useState<PayeeSuggestion[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [completedImport, setCompletedImport] = useState<CsvImportCommitResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const requestSequence = useRef(0)
  const requestController = useRef<AbortController | null>(null)

  useEffect(() => () => {
    requestSequence.current += 1
    requestController.current?.abort()
    onMutationStateChange(false)
  }, [onMutationStateChange])

  const resetPreview = () => {
    requestSequence.current += 1
    requestController.current?.abort()
    requestController.current = null
    setRows([])
    setFileText('')
    setBankDocument(null)
    setPreview(null)
    setIssues([])
    setPayeeSuggestions([])
    setSelected(new Set())
    setBusy(false)
    setError('')
    setStatus('')
    setCompletedImport(null)
  }

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    resetPreview()
    setFileName(file?.name ?? '')
    if (!file) return
    if (!available) {
      setError(t('csvImportUnavailable'))
      return
    }
    if (file.size > MAX_CSV_IMPORT_BYTES) {
      setIssues([{ row: null, code: 'file_too_large' }])
      return
    }

    const sequence = ++requestSequence.current
    const controller = new AbortController()
    requestController.current = controller
    setBusy(true)
    try {
      const bytes = await file.arrayBuffer()
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      setFileText(text)
      const parsed = await parseHushLedgerCsv(text, {
        accounts,
        categories,
      })
      if (sequence !== requestSequence.current) return
      if (parsed.issues.length === 1 && parsed.issues[0].code === 'invalid_header') {
        const delimiter = detectBankCsvDelimiter(text)
        const bank = parseBankCsvDocument(text, delimiter)
        const suggestions = bank.document
          ? await api<PayeeSuggestion[]>('/api/payee-suggestions', { signal: controller.signal }).catch(() => [])
          : []
        if (sequence !== requestSequence.current) return
        setBankDocument(bank.document)
        setPayeeSuggestions(suggestions)
        setIssues(bank.issues)
        return
      }
      if (parsed.issues.length > 0) {
        setIssues(parsed.issues)
        return
      }
      await requestPreview(parsed.rows, sequence, controller)
    } catch (caught) {
      if (controller.signal.aborted || sequence !== requestSequence.current) return
      if (caught instanceof TypeError && /encoded data/i.test(caught.message)) {
        setIssues([{ row: null, code: 'invalid_csv' }])
      } else {
        setError(renderMessage(t, messageForError(caught, 'csvImportFailed')))
      }
    } finally {
      if (sequence === requestSequence.current) {
        requestController.current = null
        setBusy(false)
      }
    }
  }

  const requestPreview = async (
    candidateRows: CsvImportRow[],
    sequence: number,
    controller: AbortController,
  ) => {
    const response = await api<unknown>('/api/imports/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'preview', rows: candidateRows }),
      signal: controller.signal,
    })
    if (sequence !== requestSequence.current) return
    const parsedPreview = csvImportPreviewResultSchema.safeParse(response)
    if (!parsedPreview.success) throw new Error('Invalid CSV preview response')
    setRows(candidateRows)
    setPreview(parsedPreview.data)
    setSelected(new Set(
      parsedPreview.data.rows
        .filter((row) => row.status === 'new' || row.status === 'match_ready')
        .map((row) => row.importKey),
    ))
  }

  const previewMappedRows = async (parsed: { rows: CsvImportRow[]; issues: CsvImportIssue[] }) => {
    setIssues(parsed.issues)
    setError('')
    setStatus('')
    setPreview(null)
    setRows(parsed.issues.length > 0 ? [] : parsed.rows)
    setSelected(new Set())
    if (parsed.issues.length > 0) return

    const sequence = ++requestSequence.current
    const controller = new AbortController()
    requestController.current = controller
    setBusy(true)
    try {
      await requestPreview(parsed.rows, sequence, controller)
    } catch (caught) {
      if (controller.signal.aborted || sequence !== requestSequence.current) return
      setError(renderMessage(t, messageForError(caught, 'csvImportFailed')))
    } finally {
      if (sequence === requestSequence.current) {
        requestController.current = null
        setBusy(false)
      }
    }
  }

  const changeBankDelimiter = (delimiter: BankCsvDelimiter) => {
    requestSequence.current += 1
    requestController.current?.abort()
    setPreview(null)
    setRows([])
    setSelected(new Set())
    const parsed = parseBankCsvDocument(fileText, delimiter)
    if (parsed.document) setBankDocument(parsed.document)
    setIssues(parsed.issues)
  }

  const toggleRow = (importKey: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(importKey)) next.delete(importKey)
      else next.add(importKey)
      return next
    })
  }

  const updateBankRowCategory = (importKey: string, categoryId: number) => {
    if (!bankDocument) return
    const next = recategorizeCsvImportReview({ rows, preview, selected }, importKey, categoryId)
    if (!next) return

    requestSequence.current += 1
    requestController.current?.abort()
    requestController.current = null
    setRows(next.rows)
    setPreview(next.preview)
    setSelected(next.selected)
    setBusy(false)
    setError('')
    setStatus(t('csvImportCategoryChanged'))
  }

  const returnToBankMapping = () => {
    requestSequence.current += 1
    requestController.current?.abort()
    requestController.current = null
    setRows([])
    setPreview(null)
    setSelected(new Set())
    setBusy(false)
    setError('')
    setStatus('')
  }

  const importSelected = async () => {
    if (!preview || !available || busy || selected.size === 0) return
    onMutationStateChange(true)
    setBusy(true)
    setError('')
    setStatus('')
    setCompletedImport(null)
    const sequence = ++requestSequence.current
    const controller = new AbortController()
    requestController.current = controller
    try {
      const response = await api<unknown>('/api/imports/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'commit',
          rows: rows.map((row) => ({ ...row, include: selected.has(row.importKey) })),
        }),
        signal: controller.signal,
      })
      if (sequence !== requestSequence.current) return
      const result = csvImportCommitResultSchema.safeParse(response)
      if (!result.success) throw new Error('Invalid CSV import response')
      if (result.data.imported > 0 || result.data.matched > 0) await onImported()
      setCompletedImport(result.data)
      setStatus(t('csvImportSuccess', {
        imported: result.data.imported,
        matched: result.data.matched,
        stale: result.data.staleSkipped,
      }))
      setFileName('')
      setFileText('')
      setBankDocument(null)
      setRows([])
      setPreview(null)
      setSelected(new Set())
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (caught) {
      if (controller.signal.aborted || sequence !== requestSequence.current) return
      if (
        caught instanceof ApiError &&
        (caught.code === 'CSV_IMPORT_BLOCKED' || caught.code === 'CSV_IMPORT_STALE')
      ) {
        setPreview(null)
        setSelected(new Set())
        setStatus(t('csvImportPreviewRequired'))
        return
      }
      setError(renderMessage(t, messageForError(caught, 'csvImportFailed')))
    } finally {
      onMutationStateChange(false)
      if (sequence === requestSequence.current) {
        requestController.current = null
        setBusy(false)
      }
    }
  }

  const previewByKey = new Map(preview?.rows.map((row) => [row.importKey, row]) ?? [])

  return (
    <section
      id="csv-import-panel"
      className="bank-import-panel csv-import-panel"
      aria-labelledby="csv-import-title"
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="bank-import-heading">
        <div>
          <h3 id="csv-import-title">{t('csvImportTitle')}</h3>
          <p>{t('csvImportHelp')}</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label={t('csvImportClose')}>
          <X aria-hidden="true" />
        </button>
      </div>

      {!available ? <p className="form-error" role="alert">{t('csvImportUnavailable')}</p> : null}

      <div className="csv-import-form">
        <label className="csv-file-picker">
          <FileUp aria-hidden="true" />
          <span>
            <strong>{t('csvImportChooseFile')}</strong>
            <small>{fileName || t('csvImportFileHelp')}</small>
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void chooseFile(event)}
            disabled={!available || busy}
          />
        </label>
        <div className="ai-provider-warning">
          <ShieldCheck aria-hidden="true" />
          <span>{t('csvImportPrivacy')}</span>
        </div>
      </div>

      {bankDocument ? (
        <BankCsvMappingForm
          key={`${fileName}:${bankDocument.delimiter}`}
          document={bankDocument}
          accounts={accounts}
          categories={categories}
          payeeSuggestions={payeeSuggestions}
          busy={busy || rows.length > 0}
          onDelimiterChange={changeBankDelimiter}
          onMapped={previewMappedRows}
        />
      ) : null}

      {busy && !preview ? (
        <p className="csv-import-progress" role="status">
          <LoaderCircle className="spin" aria-hidden="true" />
          {t('csvImportPreviewing')}
        </p>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <p className="settings-save-status" aria-live="polite" aria-atomic="true">{status}</p>
      <CsvImportCompletion
        result={completedImport}
        disabled={!available || busy}
        onReviewImports={onReviewImports}
      />

      {issues.length > 0 ? (
        <div className="csv-import-issues" role="alert">
          <div>
            <AlertTriangle aria-hidden="true" />
            <h4>{t('csvImportIssuesTitle')}</h4>
          </div>
          <ul>
            {issues.map((issue, index) => {
              const reason = t(issueMessageKey(issue.code))
              return (
                <li key={`${issue.row ?? 'file'}-${issue.code}-${index}`}>
                  {issue.row
                    ? t('csvImportIssueAtRow', { row: issue.row, reason })
                    : t('csvImportIssueFile', { reason })}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="csv-import-review">
          <div className="ai-draft-review-heading">
            <div>
              <h4>{t('csvImportReviewTitle')}</h4>
              <p>{t('csvImportReviewHelp')}</p>
            </div>
            <div className="csv-import-review-tools">
              <span>{t('csvImportSelected', { count: selected.size })}</span>
              {bankDocument ? (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={returnToBankMapping}
                >
                  {t('bankCsvChangeMapping')}
                </button>
              ) : null}
            </div>
          </div>
          {preview ? (
            <div className="csv-import-summary" aria-label={t('csvImportReviewTitle')}>
              <span className="is-ready">{t('csvImportSummaryReady', { count: preview.ready })}</span>
              <span className="is-match">{t('csvImportSummaryMatchable', { count: preview.matchable })}</span>
              <span className="is-possible">
                {t('csvImportSummaryPossible', { count: preview.possibleDuplicates })}
              </span>
              <span>{t('csvImportSummarySkipped', { count: preview.skipped })}</span>
              <span className="is-blocked">{t('csvImportSummaryBlocked', { count: preview.blocked })}</span>
            </div>
          ) : null}
          <div className="csv-import-list">
            {rows.map((row) => {
              const result = previewByKey.get(row.importKey)
              const selectable = result && (
                result.status === 'new' ||
                result.status === 'match_ready' ||
                result.status === 'possible_duplicate'
              )
              const account = accounts.find((item) => item.id === row.accountId)
              const category = categories.find((item) => item.id === row.categoryId)
              const matchingCategories = categories.filter(
                (item) => item.isActive && item.type === row.type,
              )
              const checked = selected.has(row.importKey)
              return (
                <article
                  className={`csv-import-row${result ? ` is-${result.status}` : ''}`}
                  key={row.importKey}
                >
                  <label className="csv-import-select">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!preview || !selectable || busy}
                      onChange={() => toggleRow(row.importKey)}
                      aria-label={t('csvImportSelectRow', { row: row.sourceRow })}
                    />
                    <span className="csv-import-row-heading">
                      <small>{t('csvImportRow', { row: row.sourceRow })}</small>
                      <strong>{row.payee || row.note || t(row.type)}</strong>
                    </span>
                  </label>
                  {result ? (
                    <span className={`csv-import-status is-${result.status}`}>
                      {result.status === 'new' ? <CheckCircle2 aria-hidden="true" /> : null}
                      {result.status === 'match_ready' ? <Link2 aria-hidden="true" /> : null}
                      {isBlockedStatus(result.status) ? <AlertTriangle aria-hidden="true" /> : null}
                      {t(statusMessageKey(result.status))}
                    </span>
                  ) : null}
                  <dl>
                    <div>
                      <dt>{t('date')}</dt>
                      <dd>{formatDate(row.occurredOn)}</dd>
                    </div>
                    <div>
                      <dt>{t('amount')}</dt>
                      <dd className={row.type === 'expense' ? 'expense' : 'income'}>
                        {row.type === 'expense' ? '−' : '+'}{formatMoney(row.amountMinor, row.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('account')}</dt>
                      <dd>{account ? localizeEntityName(account.name, account.localizationKey) : '—'}</dd>
                    </div>
                    <div>
                      <dt>{t('category')}</dt>
                      <dd className={bankDocument ? 'csv-import-category' : undefined}>
                        {bankDocument ? (
                          <select
                            value={row.categoryId}
                            disabled={busy}
                            onChange={(event) => updateBankRowCategory(
                              row.importKey,
                              Number(event.target.value),
                            )}
                            aria-label={t('csvImportCategoryForRow', { row: row.sourceRow })}
                          >
                            {matchingCategories.map((item) => (
                              <option value={item.id} key={item.id}>
                                {localizeEntityName(item.name, item.localizationKey)}
                              </option>
                            ))}
                          </select>
                        ) : category
                          ? localizeEntityName(category.name, category.localizationKey)
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                </article>
              )
            })}
          </div>
          <div className="csv-import-actions">
            <span>
              {preview
                ? t('csvImportSelected', { count: selected.size })
                : busy
                  ? t('csvImportPreviewing')
                  : t('csvImportPreviewRequired')}
            </span>
            {preview ? (
              <button
                className="button button-primary"
                type="button"
                onClick={() => void importSelected()}
                disabled={!available || busy || selected.size === 0}
              >
                {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <FileUp aria-hidden="true" />}
                {busy ? t('csvImportImporting') : t('csvImportImportSelected')}
              </button>
            ) : (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void previewMappedRows({ rows, issues: [] })}
                disabled={!available || busy}
              >
                {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
                {busy ? t('csvImportPreviewing') : t('bankCsvPreviewMapped')}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function CsvImportCompletion({
  result,
  disabled,
  onReviewImports,
}: {
  result: CsvImportCommitResult | null
  disabled: boolean
  onReviewImports: (status: 'unreviewed') => void
}) {
  const { t } = useI18n()
  if (!result || result.imported + result.matched === 0) return null

  return (
    <div className="ai-import-next-actions csv-import-next-actions">
      <button
        className="button button-secondary"
        type="button"
        disabled={disabled}
        onClick={() => onReviewImports('unreviewed')}
      >
        {t('aiReviewUnreviewedImports')}
      </button>
    </div>
  )
}

function issueMessageKey(code: CsvImportIssueCode): MessageKey {
  switch (code) {
    case 'empty_file': return 'csvIssueEmptyFile'
    case 'file_too_large': return 'csvIssueFileTooLarge'
    case 'invalid_csv': return 'csvIssueInvalidCsv'
    case 'invalid_header': return 'csvIssueInvalidHeader'
    case 'too_many_rows': return 'csvIssueTooManyRows'
    case 'invalid_column_count': return 'csvIssueInvalidColumnCount'
    case 'invalid_date': return 'csvIssueInvalidDate'
    case 'invalid_type': return 'csvIssueInvalidType'
    case 'invalid_amount': return 'csvIssueInvalidAmount'
    case 'invalid_currency': return 'csvIssueInvalidCurrency'
    case 'invalid_clearing_status': return 'csvIssueInvalidClearingStatus'
    case 'account_not_found': return 'csvIssueAccountNotFound'
    case 'account_ambiguous': return 'csvIssueAccountAmbiguous'
    case 'category_not_found': return 'csvIssueCategoryNotFound'
    case 'category_ambiguous': return 'csvIssueCategoryAmbiguous'
    case 'payee_too_long': return 'csvIssuePayeeTooLong'
    case 'note_too_long': return 'csvIssueNoteTooLong'
    case 'invalid_transaction_id': return 'csvIssueInvalidTransactionId'
    case 'bank_invalid_header': return 'bankCsvIssueInvalidHeader'
    case 'bank_mapping_incomplete': return 'bankCsvIssueMappingIncomplete'
    case 'bank_amount_conflict': return 'bankCsvIssueAmountConflict'
    case 'bank_duplicate_id': return 'bankCsvIssueDuplicateId'
    case 'bank_invalid_date': return 'bankCsvIssueInvalidDate'
    case 'bank_invalid_amount': return 'bankCsvIssueInvalidAmount'
  }
}

function statusMessageKey(status: CsvImportRowStatus): MessageKey {
  switch (status) {
    case 'new': return 'csvStatusNew'
    case 'match_ready': return 'csvStatusMatchReady'
    case 'possible_duplicate': return 'csvStatusPossibleDuplicate'
    case 'already_imported': return 'csvStatusAlreadyImported'
    case 'existing_transaction': return 'csvStatusExistingTransaction'
    case 'id_conflict': return 'csvStatusIdConflict'
    case 'account_invalid': return 'csvStatusAccountInvalid'
    case 'category_invalid': return 'csvStatusCategoryInvalid'
    case 'category_mismatch': return 'csvStatusCategoryMismatch'
  }
}

function isBlockedStatus(status: CsvImportRowStatus) {
  return status === 'id_conflict' ||
    status === 'account_invalid' ||
    status === 'category_invalid' ||
    status === 'category_mismatch'
}
