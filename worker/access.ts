import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

export const ACCESS_VERIFIED_HEADER = 'x-hushledger-access-verified'
export const REQUEST_ORIGIN_HEADER = 'x-hushledger-request-origin'

type AccessEnv = Pick<Env, 'CF_ACCESS_AUD' | 'CF_ACCESS_TEAM_DOMAIN'>

type AccessResult =
  | { ok: true }
  | { ok: false; code: 'ACCESS_CONFIG_MISSING' | 'ACCESS_TOKEN_INVALID' | 'ACCESS_TOKEN_MISSING' }

const keySets = new Map<string, JWTVerifyGetKey>()

export function isLocalDevelopmentUrl(url: string) {
  const hostname = new URL(url).hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

export async function verifyCloudflareAccess(request: Request, env: AccessEnv): Promise<AccessResult> {
  if (isLocalDevelopmentUrl(request.url)) return { ok: true }

  const audience = env.CF_ACCESS_AUD?.trim()
  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN)
  if (!audience || !teamDomain) return { ok: false, code: 'ACCESS_CONFIG_MISSING' }

  const token = request.headers.get('cf-access-jwt-assertion')
  if (!token) return { ok: false, code: 'ACCESS_TOKEN_MISSING' }

  try {
    await verifyAccessToken(token, getKeySet(teamDomain), teamDomain, audience)
    return { ok: true }
  } catch {
    return { ok: false, code: 'ACCESS_TOKEN_INVALID' }
  }
}

export async function verifyAccessToken(
  token: string,
  keySet: JWTVerifyGetKey,
  issuer: string,
  audience: string,
) {
  await jwtVerify(token, keySet, {
    algorithms: ['RS256'],
    audience,
    issuer,
  })
}

function normalizeTeamDomain(value: string | undefined) {
  if (!value?.trim()) return null

  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) return null
    if (!url.hostname.endsWith('.cloudflareaccess.com')) return null
    return url.origin
  } catch {
    return null
  }
}

function getKeySet(teamDomain: string) {
  const existing = keySets.get(teamDomain)
  if (existing) return existing

  const keySet = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`))
  keySets.set(teamDomain, keySet)
  return keySet
}
