import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import {
  ACCESS_VERIFIED_HEADER,
  isLocalDevelopmentUrl,
  verifyAccessToken,
  verifyCloudflareAccess,
} from './access'
import { contentSecurityPolicy, shouldNeverCache, withSecurityHeaders } from './security'

describe('Cloudflare Access boundary', () => {
  for (const url of ['http://localhost:3000', 'http://127.0.0.1:8787', 'http://[::1]:8787']) {
    it(`allows explicit local development at ${url}`, async () => {
      assert.equal(isLocalDevelopmentUrl(url), true)
      assert.deepEqual(await verifyCloudflareAccess(new Request(url), {}), { ok: true })
    })
  }

  it('fails closed on non-local hosts without Access configuration', async () => {
    assert.deepEqual(await verifyCloudflareAccess(new Request('https://ledger.example.com'), {}), {
      ok: false,
      code: 'ACCESS_CONFIG_MISSING',
    })
  })

  it('does not use the internal verification marker as authentication', async () => {
    const request = new Request('https://ledger.example.com', {
      headers: { [ACCESS_VERIFIED_HEADER]: 'true' },
    })
    assert.deepEqual(
      await verifyCloudflareAccess(request, {
        CF_ACCESS_AUD: 'audience',
        CF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
      }),
      { ok: false, code: 'ACCESS_TOKEN_MISSING' },
    )
  })

  it('cryptographically verifies the Access issuer, audience, expiry, and signature', async () => {
    const issuer = 'https://team.cloudflareaccess.com'
    const audience = 'hushledger-audience'
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const publicJwk = { ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'test', use: 'sig' }
    const keySet = createLocalJWKSet({ keys: [publicJwk] })
    const token = await new SignJWT({ email: 'owner@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
    const [header, payload, signature] = token.split('.') as [string, string, string]
    const tamperIndex = Math.floor(signature.length / 2)
    const tamperedSignature = `${signature.slice(0, tamperIndex)}${signature[tamperIndex] === 'A' ? 'B' : 'A'}${signature.slice(tamperIndex + 1)}`

    assert.equal(await verifyAccessToken(token, keySet, issuer, audience), undefined)
    await assert.rejects(verifyAccessToken(`${header}.${payload}.${tamperedSignature}`, keySet, issuer, audience))
    await assert.rejects(verifyAccessToken(token, keySet, 'https://other.cloudflareaccess.com', audience))
    await assert.rejects(verifyAccessToken(token, keySet, issuer, 'other-audience'))

    const expiredToken = await new SignJWT({ email: 'owner@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(privateKey)
    await assert.rejects(verifyAccessToken(expiredToken, keySet, issuer, audience))
  })
})

describe('security and cache policy', () => {
  it('builds a nonce CSP without unsafe-inline', () => {
    const policy = contentSecurityPolicy('nonce-value')
    assert.ok(policy.includes("script-src 'self' 'nonce-nonce-value' 'strict-dynamic'"))
    assert.ok(!policy.includes("'unsafe-inline'"))
  })

  it('never caches APIs, actions, RSC, HTML, or JSON', () => {
    const html = new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
    const json = Response.json({ ok: true })
    const script = new Response('code', { headers: { 'content-type': 'application/javascript' } })

    assert.equal(shouldNeverCache(new Request('https://app.test/api/accounts'), json, '/api/accounts'), true)
    assert.equal(
      shouldNeverCache(
        new Request('https://app.test/', { method: 'POST', headers: { 'next-action': 'id' } }),
        json,
        '/',
      ),
      true,
    )
    assert.equal(
      shouldNeverCache(new Request('https://app.test/', { headers: { rsc: '1' } }), html, '/'),
      true,
    )
    assert.equal(shouldNeverCache(new Request('https://app.test/'), html, '/'), true)
    assert.equal(shouldNeverCache(new Request('https://app.test/data'), json, '/data'), true)
    assert.equal(
      shouldNeverCache(new Request('https://app.test/_next/static/app.js'), script, '/_next/static/app.js'),
      false,
    )
  })

  it('applies strict headers and private no-store to documents', () => {
    const request = new Request('https://app.test/')
    const response = withSecurityHeaders(
      new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
      request,
      contentSecurityPolicy('nonce'),
    )

    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.ok(response.headers.get('content-security-policy')?.includes("'nonce-nonce'"))
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.ok(response.headers.get('x-robots-tag')?.includes('noindex'))
  })

  it('allows only same-origin scripts and fetches in the service worker', () => {
    const response = withSecurityHeaders(
      new Response("importScripts('/sw-runtime.js')", {
        headers: { 'content-type': 'application/javascript' },
      }),
      new Request('https://app.test/sw.js'),
      contentSecurityPolicy('nonce'),
    )

    assert.equal(
      response.headers.get('content-security-policy'),
      "default-src 'none'; connect-src 'self'; script-src 'self'",
    )
    assert.equal(response.headers.get('cache-control'), 'no-cache, no-store, must-revalidate')
    assert.equal(response.headers.get('service-worker-allowed'), '/')
  })
})

describe('container build privacy', () => {
  it('keeps local secret files out of the Docker build context', () => {
    const ignored = new Set(
      readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    )

    assert.equal(ignored.has('.env*'), true)
    assert.equal(ignored.has('.dev.vars*'), true)
  })
})
