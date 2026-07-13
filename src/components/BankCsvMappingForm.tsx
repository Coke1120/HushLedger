import { ArrowRight, TableProperties } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import {
  BANK_CSV_DATE_FORMATS,
  mapBankCsvDocument,
  suggestBankCsvMapping,
  type BankCsvAmountMode,
  type BankCsvDateFormat,
  type BankCsvDelimiter,
  type BankCsvDocument,
  type BankCsvMapping,
} from '../lib/bankCsvImport'
import {
  BANK_CSV_LAYOUTS_STORAGE_KEY,
  canRememberBankCsvLayout,
  findBankCsvLayout,
  forgetBankCsvLayout,
  parseBankCsvLayouts,
  rememberBankCsvLayout,
  serializeBankCsvLayouts,
} from '../lib/bankCsvLayouts'
import type { CsvImportParseResult } from '../lib/csvImport'
import type { Account, Category, PayeeSuggestion } from '../lib/schema'

type BankCsvMappingFormProps = {
  document: BankCsvDocument
  accounts: Account[]
  categories: Category[]
  payeeSuggestions: PayeeSuggestion[]
  busy: boolean
  onDelimiterChange: (delimiter: BankCsvDelimiter) => void
  onMapped: (result: CsvImportParseResult) => Promise<void>
}

export function BankCsvMappingForm({
  document,
  accounts,
  categories,
  payeeSuggestions,
  busy,
  onDelimiterChange,
  onMapped,
}: BankCsvMappingFormProps) {
  const { ledgerCurrency, localizeEntityName, privacyMode, t } = useI18n()
  const suggestion = useMemo(() => suggestBankCsvMapping(document), [document])
  const [savedLayout] = useState(() => {
    if (typeof window === 'undefined') return null
    try {
      return findBankCsvLayout(
        parseBankCsvLayouts(window.localStorage.getItem(BANK_CSV_LAYOUTS_STORAGE_KEY)),
        document,
      )
    } catch {
      return null
    }
  })
  const initialMapping = savedLayout ?? suggestion
  const activeAccounts = accounts.filter(
    (account) => account.isActive && account.currency === ledgerCurrency,
  )
  const expenseCategories = categories.filter((category) => category.isActive && category.type === 'expense')
  const incomeCategories = categories.filter((category) => category.isActive && category.type === 'income')
  const [dateColumn, setDateColumn] = useState(initialMapping.dateColumn ?? -1)
  const [dateFormat, setDateFormat] = useState<BankCsvDateFormat>(initialMapping.dateFormat ?? 'yyyy-mm-dd')
  const [payeeColumn, setPayeeColumn] = useState(initialMapping.payeeColumn ?? -1)
  const [noteColumn, setNoteColumn] = useState(initialMapping.noteColumn ?? -1)
  const [idColumn, setIdColumn] = useState(initialMapping.idColumn ?? -1)
  const [amountMode, setAmountMode] = useState<BankCsvAmountMode>(initialMapping.amountMode)
  const [amountColumn, setAmountColumn] = useState(initialMapping.amountColumn ?? -1)
  const [debitColumn, setDebitColumn] = useState(initialMapping.debitColumn ?? -1)
  const [creditColumn, setCreditColumn] = useState(initialMapping.creditColumn ?? -1)
  const [flipSign, setFlipSign] = useState(initialMapping.flipSign ?? false)
  const [rememberPayeeCategories, setRememberPayeeCategories] = useState(
    initialMapping.rememberPayeeCategories ?? true,
  )
  const [rememberLayout, setRememberLayout] = useState(savedLayout !== null)
  const layoutCanBeRemembered = canRememberBankCsvLayout(document)
  const [accountId, setAccountId] = useState(activeAccounts[0]?.id ?? 0)
  const [expenseCategoryId, setExpenseCategoryId] = useState(
    expenseCategories.find((category) => category.localizationKey === 'category.other_expense')?.id ??
      expenseCategories[0]?.id ??
      0,
  )
  const [incomeCategoryId, setIncomeCategoryId] = useState(
    incomeCategories.find((category) => category.localizationKey === 'category.other_income')?.id ??
      incomeCategories[0]?.id ??
      0,
  )

  const complete = dateColumn >= 0 && payeeColumn >= 0 && accountId > 0 &&
    expenseCategoryId > 0 && incomeCategoryId > 0 && (
      amountMode === 'signed'
        ? amountColumn >= 0
        : debitColumn >= 0 && creditColumn >= 0 && debitColumn !== creditColumn
    )

  const previewMappedRows = async () => {
    if (!complete || busy) return
    const base = {
      dateColumn,
      dateFormat,
      payeeColumn,
      noteColumn: noteColumn >= 0 ? noteColumn : null,
      idColumn: idColumn >= 0 ? idColumn : null,
      accountId,
      expenseCategoryId,
      incomeCategoryId,
      flipSign,
      rememberPayeeCategories,
    }
    const mapping: BankCsvMapping = amountMode === 'signed'
      ? { ...base, amountMode, amountColumn, debitColumn: null, creditColumn: null }
      : { ...base, amountMode, amountColumn: null, debitColumn, creditColumn }
    const result = await mapBankCsvDocument(document, mapping, {
      accounts,
      categories,
      currency: ledgerCurrency,
      payeeSuggestions,
    })
    try {
      const stored = parseBankCsvLayouts(
        window.localStorage.getItem(BANK_CSV_LAYOUTS_STORAGE_KEY),
      )
      const next = rememberLayout && result.issues.length === 0
        ? rememberBankCsvLayout(stored, document, mapping)
        : rememberLayout
          ? stored
          : forgetBankCsvLayout(stored, document)
      window.localStorage.setItem(
        BANK_CSV_LAYOUTS_STORAGE_KEY,
        serializeBankCsvLayouts(next),
      )
    } catch {
      // Mapping and preview remain available when browser storage is unavailable.
    }
    await onMapped(result)
  }

  return (
    <div className="bank-csv-mapping">
      <div className="bank-csv-mapping-heading">
        <TableProperties aria-hidden="true" />
        <div>
          <h4>{t('bankCsvMappingTitle')}</h4>
          <p>{t('bankCsvMappingHelp', {
            rows: document.rows.length,
            columns: document.headers.length,
          })}</p>
        </div>
      </div>

      <div className="bank-csv-map-grid">
        <label>
          <span>{t('bankCsvDelimiter')}</span>
          <select
            value={document.delimiter}
            disabled={busy}
            onChange={(event) => onDelimiterChange(event.target.value as BankCsvDelimiter)}
          >
            <option value=",">{t('bankCsvDelimiterComma')}</option>
            <option value=";">{t('bankCsvDelimiterSemicolon')}</option>
            <option value={'\t'}>{t('bankCsvDelimiterTab')}</option>
          </select>
        </label>
        <ColumnSelect
          label={t('bankCsvDateColumn')}
          value={dateColumn}
          headers={document.headers}
          required
          disabled={busy}
          onChange={setDateColumn}
        />
        <label>
          <span>{t('bankCsvDateFormat')}</span>
          <select
            value={dateFormat}
            disabled={busy}
            onChange={(event) => setDateFormat(event.target.value as BankCsvDateFormat)}
          >
            {BANK_CSV_DATE_FORMATS.map((format) => (
              <option value={format} key={format}>{dateFormatLabel(format)}</option>
            ))}
          </select>
        </label>
        <ColumnSelect
          label={t('bankCsvPayeeColumn')}
          value={payeeColumn}
          headers={document.headers}
          required
          disabled={busy}
          onChange={setPayeeColumn}
        />
        <ColumnSelect
          label={t('bankCsvNoteColumn')}
          value={noteColumn}
          headers={document.headers}
          disabled={busy}
          onChange={setNoteColumn}
        />
        <ColumnSelect
          label={t('bankCsvIdColumn')}
          value={idColumn}
          headers={document.headers}
          disabled={busy}
          onChange={setIdColumn}
        />
        <label>
          <span>{t('bankCsvAmountMode')}</span>
          <select
            value={amountMode}
            disabled={busy}
            onChange={(event) => setAmountMode(event.target.value as BankCsvAmountMode)}
          >
            <option value="signed">{t('bankCsvSignedAmount')}</option>
            <option value="split">{t('bankCsvSplitAmount')}</option>
          </select>
        </label>
        {amountMode === 'signed' ? (
          <ColumnSelect
            label={t('bankCsvAmountColumn')}
            value={amountColumn}
            headers={document.headers}
            required
            disabled={busy}
            onChange={setAmountColumn}
          />
        ) : (
          <>
            <ColumnSelect
              label={t('bankCsvDebitColumn')}
              value={debitColumn}
              headers={document.headers}
              required
              disabled={busy}
              onChange={setDebitColumn}
            />
            <ColumnSelect
              label={t('bankCsvCreditColumn')}
              value={creditColumn}
              headers={document.headers}
              required
              disabled={busy}
              onChange={setCreditColumn}
            />
          </>
        )}
        <label>
          <span>{t('bankCsvTargetAccount')}</span>
          <select
            value={accountId}
            disabled={busy}
            onChange={(event) => setAccountId(Number(event.target.value))}
          >
            {activeAccounts.map((account) => (
              <option value={account.id} key={account.id}>
                {localizeEntityName(account.name, account.localizationKey)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('bankCsvExpenseCategory')}</span>
          <select
            value={expenseCategoryId}
            disabled={busy}
            onChange={(event) => setExpenseCategoryId(Number(event.target.value))}
          >
            {expenseCategories.map((category) => (
              <option value={category.id} key={category.id}>
                {localizeEntityName(category.name, category.localizationKey)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('bankCsvIncomeCategory')}</span>
          <select
            value={incomeCategoryId}
            disabled={busy}
            onChange={(event) => setIncomeCategoryId(Number(event.target.value))}
          >
            {incomeCategories.map((category) => (
              <option value={category.id} key={category.id}>
                {localizeEntityName(category.name, category.localizationKey)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="bank-csv-flip-sign">
        <input
          type="checkbox"
          checked={flipSign}
          disabled={busy}
          onChange={(event) => setFlipSign(event.target.checked)}
        />
        <span>
          <strong>{t('bankCsvFlipSign')}</strong>
          <small>{t('bankCsvFlipSignHelp')}</small>
        </span>
      </label>

      <label className="bank-csv-flip-sign">
        <input
          type="checkbox"
          checked={rememberPayeeCategories && payeeSuggestions.length > 0}
          disabled={busy || payeeSuggestions.length === 0}
          onChange={(event) => setRememberPayeeCategories(event.target.checked)}
        />
        <span>
          <strong>{t('bankCsvRememberCategories')}</strong>
          <small>{t('bankCsvRememberCategoriesHelp')}</small>
        </span>
      </label>

      <label className="bank-csv-flip-sign">
        <input
          type="checkbox"
          checked={rememberLayout && layoutCanBeRemembered}
          disabled={busy || !layoutCanBeRemembered}
          onChange={(event) => setRememberLayout(event.target.checked)}
        />
        <span>
          <strong>{t('bankCsvRememberLayout')}</strong>
          <small>
            {t(savedLayout ? 'bankCsvRememberLayoutApplied' : 'bankCsvRememberLayoutHelp')}
          </small>
        </span>
      </label>

      <div className="bank-csv-sample" tabIndex={0} aria-label={t('bankCsvSampleTitle')}>
        <table>
          <caption>{t('bankCsvSampleTitle')}</caption>
          <thead>
            <tr>{document.headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {document.rows.slice(0, 3).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((value, columnIndex) => (
                  <td key={columnIndex}>
                    {privacyMode && value ? t('sensitiveTextHidden') : value || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bank-csv-map-actions">
        <span>{t('bankCsvMappingPrivacy')}</span>
        <button
          type="button"
          className="button button-primary"
          disabled={!complete || busy}
          onClick={() => void previewMappedRows()}
        >
          <ArrowRight aria-hidden="true" />
          {t('bankCsvPreviewMapped')}
        </button>
      </div>
    </div>
  )
}

type ColumnSelectProps = {
  label: string
  value: number
  headers: string[]
  required?: boolean
  disabled: boolean
  onChange: (value: number) => void
}

function ColumnSelect({
  label,
  value,
  headers,
  required = false,
  disabled,
  onChange,
}: ColumnSelectProps) {
  const { t } = useI18n()
  return (
    <label>
      <span>{label}</span>
      <select
        value={value}
        required={required}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        <option value={-1}>{required ? t('bankCsvChooseColumn') : t('bankCsvLeaveBlank')}</option>
        {headers.map((header, index) => <option value={index} key={header}>{header}</option>)}
      </select>
    </label>
  )
}

function dateFormatLabel(format: BankCsvDateFormat) {
  switch (format) {
    case 'yyyy-mm-dd': return 'YYYY-MM-DD'
    case 'dd/mm/yyyy': return 'DD/MM/YYYY'
    case 'mm/dd/yyyy': return 'MM/DD/YYYY'
    case 'yyyy/mm/dd': return 'YYYY/MM/DD'
    case 'dd-mm-yyyy': return 'DD-MM-YYYY'
  }
}
