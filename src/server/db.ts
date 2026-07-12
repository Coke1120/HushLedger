import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'

type HushLedgerEnv = CloudflareEnv & { DB: D1Database }

export async function getDatabase() {
  const { env } = await getCloudflareContext({ async: true })
  return (env as HushLedgerEnv).DB
}
