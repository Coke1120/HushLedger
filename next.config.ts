import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import { randomUUID } from 'node:crypto'
import type { NextConfig } from 'next'

const devPersistPath = process.env.HUSHLEDGER_DEV_PERSIST_PATH
const devWranglerConfigPath = process.env.HUSHLEDGER_DEV_WRANGLER_CONFIG_PATH
const releaseId = process.env.HUSHLEDGER_RELEASE_ID ?? process.env.GITHUB_SHA ?? randomUUID()
void initOpenNextCloudflareForDev(
  devPersistPath || devWranglerConfigPath
    ? {
        ...(devPersistPath ? { persist: { path: devPersistPath } } : {}),
        ...(devWranglerConfigPath ? { configPath: devWranglerConfigPath } : {}),
      }
    : undefined,
)

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: import.meta.dirname,
  },
  env: {
    HUSHLEDGER_RELEASE_ID: releaseId,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '16kb',
    },
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ]
  },
}

export default nextConfig
