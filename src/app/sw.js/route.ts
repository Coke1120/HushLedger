function productionServiceWorkerEntry(releaseId: string) {
  return [
    `globalThis.__HUSHLEDGER_RELEASE_ID__ = ${JSON.stringify(releaseId)}`,
    "importScripts('/sw-runtime.js')",
    '',
  ].join('\n')
}

const developmentServiceWorkerEntry = `self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    await Promise.allSettled(
      cacheNames
        .filter((name) => name.startsWith('hushledger-') || name.startsWith('workbox-'))
        .map((name) => caches.delete(name)),
    )

    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    await self.registration.unregister()
    await Promise.allSettled(clients.map((client) => client.navigate(client.url)))
  })())
})
`

export function serviceWorkerEntryForEnvironment(
  environment: string | undefined,
  releaseId: string,
) {
  return environment === 'production'
    ? productionServiceWorkerEntry(releaseId)
    : developmentServiceWorkerEntry
}

export function GET() {
  const releaseId = process.env.HUSHLEDGER_RELEASE_ID ?? 'development'
  const serviceWorkerEntry = serviceWorkerEntryForEnvironment(process.env.NODE_ENV, releaseId)

  return new Response(serviceWorkerEntry, {
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Content-Type': 'application/javascript; charset=utf-8',
      'Service-Worker-Allowed': '/',
    },
  })
}
