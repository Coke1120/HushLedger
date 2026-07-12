const releaseId = process.env.HUSHLEDGER_RELEASE_ID ?? 'development'
const serviceWorkerEntry = [
  `globalThis.__HUSHLEDGER_RELEASE_ID__ = ${JSON.stringify(releaseId)}`,
  "importScripts('/sw-runtime.js')",
  '',
].join('\n')

export function GET() {
  return new Response(serviceWorkerEntry, {
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Content-Type': 'application/javascript; charset=utf-8',
      'Service-Worker-Allowed': '/',
    },
  })
}
