import 'server-only'

import { headers } from 'next/headers'

export async function isServerActionAllowed() {
  try {
    const requestHeaders = await headers()
    if (requestHeaders.get('x-hushledger-access-verified') === 'true') return true

    const host = requestHeaders.get('host')
    if (!host) return false
    const hostname = new URL(`http://${host}`).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}
