import { ApiError } from '../lib/api'
import type { MessageKey } from './messages'
import type { MessageValue, Translator } from './core'

export type LocalizedMessageValues = Record<string, MessageValue | LocalizedMessage>

export type LocalizedMessage = {
  key: MessageKey
  values?: LocalizedMessageValues
}

const apiErrorMessageKeys: Readonly<Record<string, MessageKey>> = {
  REQUEST_FAILED: 'errorRequestFailed',
  ACCESS_FORBIDDEN: 'errorAccessForbidden',
  ORIGIN_FORBIDDEN: 'errorOriginForbidden',
  PAYLOAD_TOO_LARGE: 'errorPayloadTooLarge',
  UNSUPPORTED_MEDIA_TYPE: 'errorUnsupportedMediaType',
  INVALID_JSON: 'errorInvalidJson',
  ID_CONFLICT: 'errorIdConflict',
  ACCOUNT_INVALID: 'errorAccountInvalid',
  CATEGORY_INVALID: 'errorCategoryInvalid',
  CATEGORY_TYPE_MISMATCH: 'errorCategoryMismatch',
  TRANSACTION_NOT_FOUND: 'errorTransactionNotFound',
  TRANSACTION_VERSION_CONFLICT: 'errorTransactionVersionConflict',
  RULE_NOT_FOUND: 'errorRuleNotFound',
  RULE_VERSION_CONFLICT: 'errorRuleVersionConflict',
  REFERENCE_NOT_FOUND: 'errorReferenceNotFound',
  REFERENCE_VERSION_CONFLICT: 'errorReferenceVersionConflict',
  REFERENCE_NAME_CONFLICT: 'errorReferenceNameConflict',
  REFERENCE_LAST_ACTIVE: 'errorReferenceLastActive',
  REFERENCE_ACTIVE_RULES: 'errorReferenceActiveRules',
  AI_PROVIDER_CONFIG_INVALID: 'errorAiProviderConfig',
  AI_PROVIDER_AUTH_FAILED: 'errorAiProviderAuth',
  AI_PROVIDER_RATE_LIMITED: 'errorAiProviderRateLimit',
  AI_PROVIDER_TIMEOUT: 'errorAiProviderTimeout',
  AI_PROVIDER_RESPONSE_TOO_LARGE: 'errorAiProviderResponse',
  AI_PROVIDER_RESPONSE_INVALID: 'errorAiProviderResponse',
  AI_PROVIDER_UNAVAILABLE: 'errorAiProviderUnavailable',
  AI_PARSE_INPUT_INVALID: 'errorAiParseFailed',
  AI_STATEMENT_TOO_LARGE: 'errorAiStatementTooLarge',
  INTERNAL_ERROR: 'errorServer',
}

export function message(key: MessageKey, values?: LocalizedMessageValues): LocalizedMessage {
  return values ? { key, values } : { key }
}

export function messageForError(error: unknown, fallbackKey: MessageKey): LocalizedMessage {
  if (error instanceof ApiError) {
    return message(apiErrorMessageKeys[error.code] ?? fallbackKey)
  }
  return message(fallbackKey)
}

export function renderMessage(t: Translator, value: LocalizedMessage | null): string {
  if (!value) return ''
  const resolvedValues: Record<string, MessageValue> | undefined = value.values
    ? Object.fromEntries(
        Object.entries(value.values).map(([name, item]) => [
          name,
          typeof item === 'object' ? renderMessage(t, item) : item,
        ]),
      )
    : undefined
  return t(value.key, resolvedValues)
}
