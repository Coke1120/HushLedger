import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import { randomUUID } from 'node:crypto'
import type { NextConfig } from 'next'

const devPersistPath = process.env.HUSHLEDGER_DEV_PERSIST_PATH
const releaseId = process.env.HUSHLEDGER_RELEASE_ID ?? process.env.GITHUB_SHA ?? randomUUID()
void initOpenNextCloudflareForDev(
  devPersistPath ? { persist: { path: devPersistPath } } : undefined,
)

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
