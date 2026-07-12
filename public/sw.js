const STATIC_CACHE = 'hushledger-static-v1'
const OFFLINE_CACHE = 'hushledger-offline-v1'
const OFFLINE_URL = '/offline'
const PUBLIC_ASSETS = new Set([
  '/apple-touch-icon.png',
  '/favicon.svg',
  '/pwa-192.png',
  '/pwa-512.png',
])
const PRECACHE = [...PUBLIC_ASSETS]

function shouldUseOfflineFallback(request) {
  return request.method === 'GET' && request.mode === 'navigate'
}

function shouldCacheStaticRequest(request, origin) {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  return url.origin === origin && (
    url.pathname.startsWith('/_next/static/') || PUBLIC_ASSETS.has(url.pathname)
  )
}

function isObsoleteCache(name) {
  return name.startsWith('workbox-') || (
    name.startsWith('hushledger-') && name !== STATIC_CACHE && name !== OFFLINE_CACHE
  )
}

function offlineStaticAssetPaths(html) {
  const paths = new Set()
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const path = match[1]
    if (path.startsWith('/_next/static/')) paths.add(path)
  }
  return [...paths]
}

async function precacheOfflineShell() {
  const [offlineCache, staticCache] = await Promise.all([
    caches.open(OFFLINE_CACHE),
    caches.open(STATIC_CACHE),
  ])
  await offlineCache.addAll(PRECACHE)

  const response = await fetch(OFFLINE_URL, { cache: 'no-store' })
  if (!response.ok) throw new Error('Offline shell could not be fetched')
  await offlineCache.put(OFFLINE_URL, response.clone())

  const assetPaths = offlineStaticAssetPaths(await response.text())
  await Promise.all(assetPaths.map(async (path) => {
    const asset = await fetch(path, { cache: 'no-store' })
    if (asset.ok && asset.type === 'basic') await staticCache.put(path, asset)
  }))
}

const isServiceWorker =
  typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope

if (!isServiceWorker) {
  globalThis.__HUSHLEDGER_SW_POLICY__ = {
    isObsoleteCache,
    offlineStaticAssetPaths,
    shouldCacheStaticRequest,
    shouldUseOfflineFallback,
  }
} else {
  self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
      await precacheOfflineShell()
      await self.skipWaiting()
    })())
  })

  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      const names = await caches.keys()
      await Promise.all(names.filter(isObsoleteCache).map((name) => caches.delete(name)))
      await self.clients.claim()
    })())
  })

  self.addEventListener('fetch', (event) => {
    const { request } = event

    if (shouldUseOfflineFallback(request)) {
      event.respondWith((async () => {
        try {
          return await fetch(request, { cache: 'no-store' })
        } catch {
          return (await caches.match(OFFLINE_URL)) ?? Response.error()
        }
      })())
      return
    }

    if (!shouldCacheStaticRequest(request, self.location.origin)) return

    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE)
      const cached = await cache.match(request)
      if (cached) return cached

      const response = await fetch(request)
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone())
      return response
    })())
  })
}
