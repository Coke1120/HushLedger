import type { zhHantMessages } from './zh-Hant'

export type MessageKey = keyof typeof zhHantMessages
export type MessageDictionary = Record<MessageKey, string>
