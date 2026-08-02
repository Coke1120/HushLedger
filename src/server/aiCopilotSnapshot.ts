import 'server-only'

import { readLedgerRevision } from './money'

const AI_COPILOT_SNAPSHOT_ATTEMPTS = 3

export type StableAiCopilotSnapshot<T> = {
  revision: number
  value: T
}

export async function loadStableAiCopilotSnapshot<T>(
  database: D1Database,
  load: () => Promise<T>,
): Promise<StableAiCopilotSnapshot<T> | null> {
  for (let attempt = 0; attempt < AI_COPILOT_SNAPSHOT_ATTEMPTS; attempt += 1) {
    const revision = await readLedgerRevision(database)
    const value = await load()
    if (await readLedgerRevision(database) === revision) {
      return { revision, value }
    }
  }
  return null
}
