import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'

type HushLedgerEnv = CloudflareEnv & {
  DB: D1Database
  HUSHLEDGER_PUBLIC_DEMO?: string
}

export async function getCloudflareEnv(): Promise<HushLedgerEnv> {
  const { env } = await getCloudflareContext({ async: true })
  return env as HushLedgerEnv
}

export async function getDatabase() {
  return (await getCloudflareEnv()).DB
}
