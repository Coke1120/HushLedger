import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// HushLedger deliberately avoids ISR/R2/tag caches: ledger data is private and always no-store.
export default defineCloudflareConfig()
