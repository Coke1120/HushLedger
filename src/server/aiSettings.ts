import 'server-only'

import {
  aiProviderSettingsSchema,
  aiProviderSettingsWriteSchema,
  type AiProviderSettings,
  type AiProviderSettingsRow,
  type AiProviderSettingsWrite,
} from '../lib/ai'

const ENCRYPTION_KEY_VERSION = 1
const SETTINGS_ROW_ID = 1

type RawSettingsMetadata = {
  baseUrl: string
  model: string
  createdAt: string
  updatedAt: string
}

type EncryptedSettingsRow = RawSettingsMetadata & {
  apiKeyCiphertext: ArrayBuffer | ArrayBufferView | number[]
  apiKeyIv: ArrayBuffer | ArrayBufferView | number[]
  encryptionKeyVersion: number
}

export type AiProviderSettingsSaveResult =
  | { kind: 'created' | 'updated'; settings: AiProviderSettingsRow }
  | { kind: 'version_conflict' }
  | { kind: 'invalid_input' }
  | { kind: 'api_key_required' }

export type AiProviderSettingsDeleteResult =
  | { kind: 'deleted' }
  | { kind: 'not_found' | 'version_conflict' }

export type StoredAiProviderSettingsResult =
  | { kind: 'found'; settings: AiProviderSettings }
  | { kind: 'not_found' }
  | { kind: 'version_conflict' }

export type AiSettingsCryptoErrorCode =
  | 'ENCRYPTION_KEY_INVALID'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
  | 'KEY_VERSION_UNSUPPORTED'

export class AiSettingsCryptoError extends Error {
  readonly code: AiSettingsCryptoErrorCode

  constructor(code: AiSettingsCryptoErrorCode) {
    super('AI settings encryption operation failed')
    this.name = 'AiSettingsCryptoError'
    this.code = code
  }
}

const selectMetadataQuery = `
  SELECT
    base_url AS baseUrl,
    model,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM ai_provider_settings
  WHERE id = 1
`

const selectEncryptedQuery = `
  SELECT
    base_url AS baseUrl,
    api_key_ciphertext AS apiKeyCiphertext,
    api_key_iv AS apiKeyIv,
    encryption_key_version AS encryptionKeyVersion,
    model,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM ai_provider_settings
  WHERE id = 1
`

const nextUpdatedAt = `
  CASE
    WHEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') > updated_at
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds')
  END
`

export async function getAiProviderSettings(
  database: D1Database,
): Promise<AiProviderSettingsRow | null> {
  return toPublicSettings(
    await database.prepare(selectMetadataQuery).first<RawSettingsMetadata>(),
  )
}

export async function getStoredAiProviderSettings(
  database: D1Database,
  encryptionKeyHex: string | undefined,
  expectedUpdatedAt: string,
): Promise<StoredAiProviderSettingsResult> {
  const stored = await database.prepare(selectEncryptedQuery).first<EncryptedSettingsRow>()
  if (!stored) return { kind: 'not_found' }
  if (stored.updatedAt !== expectedUpdatedAt) return { kind: 'version_conflict' }
  if (stored.encryptionKeyVersion !== ENCRYPTION_KEY_VERSION) {
    throw new AiSettingsCryptoError('KEY_VERSION_UNSUPPORTED')
  }

  const apiKey = await decryptApiKey(
    stored.apiKeyCiphertext,
    stored.apiKeyIv,
    stored.baseUrl,
    encryptionKeyHex,
  )
  const settings = aiProviderSettingsSchema.safeParse({
    baseUrl: stored.baseUrl,
    apiKey,
    model: stored.model,
  })
  if (!settings.success) throw new AiSettingsCryptoError('DECRYPTION_FAILED')
  return { kind: 'found', settings: settings.data }
}

export async function saveAiProviderSettings(
  database: D1Database,
  input: AiProviderSettingsWrite,
  expectedUpdatedAt: string | null,
  encryptionKeyHex: string | undefined,
): Promise<AiProviderSettingsSaveResult> {
  const parsed = aiProviderSettingsWriteSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid_input' }

  if (expectedUpdatedAt === null) {
    if (!parsed.data.apiKey) return { kind: 'api_key_required' }
    if (await database.prepare(selectMetadataQuery).first<RawSettingsMetadata>()) {
      return { kind: 'version_conflict' }
    }
    const encrypted = await encryptApiKey(
      parsed.data.apiKey,
      parsed.data.baseUrl,
      encryptionKeyHex,
    )
    const inserted = await database.prepare(`
      INSERT INTO ai_provider_settings(
        id,
        base_url,
        api_key_ciphertext,
        api_key_iv,
        encryption_key_version,
        model,
        created_at,
        updated_at
      )
      VALUES (
        1,
        ?,
        ?,
        ?,
        ${ENCRYPTION_KEY_VERSION},
        ?,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
      ON CONFLICT(id) DO NOTHING
      RETURNING base_url AS baseUrl, model, created_at AS createdAt, updated_at AS updatedAt
    `).bind(
      parsed.data.baseUrl,
      encrypted.ciphertext,
      encrypted.iv,
      parsed.data.model,
    ).run()

    const settings = toPublicSettings(inserted.results[0] as RawSettingsMetadata | undefined)
    return settings
      ? { kind: 'created', settings }
      : { kind: 'version_conflict' }
  }

  const current = await database.prepare(selectMetadataQuery).first<RawSettingsMetadata>()
  if (!current || current.updatedAt !== expectedUpdatedAt) {
    return { kind: 'version_conflict' }
  }

  if (!parsed.data.apiKey) {
    if (current.baseUrl !== parsed.data.baseUrl) return { kind: 'api_key_required' }

    const updated = await database.prepare(`
      UPDATE ai_provider_settings
      SET base_url = ?, model = ?, updated_at = ${nextUpdatedAt}
      WHERE id = 1 AND updated_at = ?
      RETURNING base_url AS baseUrl, model, created_at AS createdAt, updated_at AS updatedAt
    `).bind(parsed.data.baseUrl, parsed.data.model, expectedUpdatedAt).run()
    const settings = toPublicSettings(updated.results[0] as RawSettingsMetadata | undefined)
    return settings
      ? { kind: 'updated', settings }
      : { kind: 'version_conflict' }
  }

  const encrypted = await encryptApiKey(
    parsed.data.apiKey,
    parsed.data.baseUrl,
    encryptionKeyHex,
  )
  const updated = await database.prepare(`
    UPDATE ai_provider_settings
    SET
      base_url = ?,
      api_key_ciphertext = ?,
      api_key_iv = ?,
      encryption_key_version = ${ENCRYPTION_KEY_VERSION},
      model = ?,
      updated_at = ${nextUpdatedAt}
    WHERE id = 1 AND updated_at = ?
    RETURNING base_url AS baseUrl, model, created_at AS createdAt, updated_at AS updatedAt
  `).bind(
    parsed.data.baseUrl,
    encrypted.ciphertext,
    encrypted.iv,
    parsed.data.model,
    expectedUpdatedAt,
  ).run()

  const settings = toPublicSettings(updated.results[0] as RawSettingsMetadata | undefined)
  return settings
    ? { kind: 'updated', settings }
    : { kind: 'version_conflict' }
}

export async function deleteAiProviderSettings(
  database: D1Database,
  expectedUpdatedAt: string,
): Promise<AiProviderSettingsDeleteResult> {
  const deleted = await database.prepare(`
    DELETE FROM ai_provider_settings
    WHERE id = 1 AND updated_at = ?
  `).bind(expectedUpdatedAt).run()
  if (Number(deleted.meta.changes) > 0) return { kind: 'deleted' }

  return await getAiProviderSettings(database)
    ? { kind: 'version_conflict' }
    : { kind: 'not_found' }
}

function toPublicSettings(
  settings: RawSettingsMetadata | null | undefined,
): AiProviderSettingsRow | null {
  if (!settings) return null
  return { ...settings, hasApiKey: true }
}

async function encryptApiKey(
  apiKey: string,
  baseUrl: string,
  encryptionKeyHex: string | undefined,
) {
  const key = await importEncryptionKey(encryptionKeyHex, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  try {
    return {
      ciphertext: await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encryptionAdditionalData(baseUrl) },
        key,
        new TextEncoder().encode(apiKey),
      ),
      iv: iv.buffer,
    }
  } catch {
    throw new AiSettingsCryptoError('ENCRYPTION_FAILED')
  }
}

async function decryptApiKey(
  ciphertext: ArrayBuffer | ArrayBufferView | number[],
  iv: ArrayBuffer | ArrayBufferView | number[],
  baseUrl: string,
  encryptionKeyHex: string | undefined,
) {
  const ivBytes = encryptedBytes(iv)
  const ciphertextBytes = encryptedBytes(ciphertext)
  if (ivBytes.byteLength !== 12 || ciphertextBytes.byteLength <= 16) {
    throw new AiSettingsCryptoError('DECRYPTION_FAILED')
  }
  const key = await importEncryptionKey(encryptionKeyHex, ['decrypt'])
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBytes,
        additionalData: encryptionAdditionalData(baseUrl),
      },
      key,
      ciphertextBytes,
    )
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
  } catch {
    throw new AiSettingsCryptoError('DECRYPTION_FAILED')
  }
}

function encryptedBytes(value: ArrayBuffer | ArrayBufferView | number[]) {
  try {
    if (Array.isArray(value)) {
      if (value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
        throw new Error('Invalid encrypted byte')
      }
      return Uint8Array.from(value)
    }
    if (ArrayBuffer.isView(value)) {
      return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    }
    return new Uint8Array(value)
  } catch {
    throw new AiSettingsCryptoError('DECRYPTION_FAILED')
  }
}

function encryptionAdditionalData(baseUrl: string) {
  return new TextEncoder().encode(JSON.stringify({
    purpose: 'hushledger.ai_provider_settings.api_key',
    rowId: SETTINGS_ROW_ID,
    encryptionKeyVersion: ENCRYPTION_KEY_VERSION,
    baseUrl,
  }))
}

async function importEncryptionKey(
  encryptionKeyHex: string | undefined,
  usages: KeyUsage[],
) {
  if (!encryptionKeyHex || !/^[0-9a-fA-F]{64}$/.test(encryptionKeyHex)) {
    throw new AiSettingsCryptoError('ENCRYPTION_KEY_INVALID')
  }

  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(encryptionKeyHex.slice(index * 2, index * 2 + 2), 16)
  }
  try {
    return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, usages)
  } catch {
    throw new AiSettingsCryptoError('ENCRYPTION_KEY_INVALID')
  }
}
