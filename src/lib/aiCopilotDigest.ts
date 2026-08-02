import type { AiCopilotContext } from './aiCopilot'
import { canonicalJson, sha256Hex } from './ledgerBackup'

const AI_COPILOT_CONTEXT_DIGEST_VERSION = 1

export function digestAiCopilotContext(context: AiCopilotContext) {
  return sha256Hex(canonicalJson({
    version: AI_COPILOT_CONTEXT_DIGEST_VERSION,
    context,
  }))
}
