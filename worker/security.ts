const PRIVATE_CACHE_CONTROL = 'private, no-store'

export function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function contentSecurityPolicy(nonce: string, upgradeInsecureRequests = true) {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' blob: data:",
    "manifest-src 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "worker-src 'self'",
  ]
  if (upgradeInsecureRequests) directives.push('upgrade-insecure-requests')
  return directives.join('; ')
}

export function withSecurityHeaders(
  response: Response,
  request: Request,
  policy: string,
) {
  const secured = new Response(response.body, response)
  const headers = secured.headers

  headers.set('Content-Security-Policy', policy)
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  headers.set('Cross-Origin-Resource-Policy', 'same-origin')
  headers.set('Origin-Agent-Cluster', '?1')
  headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-DNS-Prefetch-Control', 'off')
  headers.set('X-Download-Options', 'noopen')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('X-Permitted-Cross-Domain-Policies', 'none')
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  headers.set('X-XSS-Protection', '0')
  headers.delete('X-Powered-By')

  const url = new URL(request.url)
  if (shouldNeverCache(request, response, url.pathname)) {
    headers.set('Cache-Control', PRIVATE_CACHE_CONTROL)
  } else if (url.pathname === '/sw.js') {
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    headers.set('Service-Worker-Allowed', '/')
  }

  return secured
}

export function shouldNeverCache(request: Request, response: Response, pathname: string) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return true
  if (pathname.startsWith('/api/')) return true
  if (request.headers.has('next-action')) return true
  if (request.headers.has('rsc') || request.headers.get('accept')?.includes('text/x-component')) return true

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  return contentType.includes('text/html') || contentType.includes('application/json')
}

export function accessFailureResponse(code: string) {
  const configMissing = code === 'ACCESS_CONFIG_MISSING'
  return Response.json(
    {
      ok: false,
      error: {
        code,
        message: configMissing ? 'Cloudflare Access is not configured.' : 'Access denied.',
      },
    },
    {
      status: configMissing ? 503 : 403,
      headers: {
        'Cache-Control': PRIVATE_CACHE_CONTROL,
        'Content-Type': 'application/json; charset=utf-8',
      },
    },
  )
}
