import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { createLedgerGateway, stopOwnedProcessGroup } from './lifecycle.mjs'

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

async function unusedPort() {
  const reservation = createServer()
  const port = await listen(reservation)
  await new Promise((resolve) => reservation.close(resolve))
  return port
}

async function fixture(t, handler) {
  const backend = createServer(handler)
  const backendPort = await listen(backend)
  const port = await unusedPort()
  const gateway = createLedgerGateway(port)
  await gateway.listen()
  gateway.setBackend(backendPort)
  t.after(async () => {
    await gateway.close()
    backend.closeAllConnections()
    await new Promise((resolve) => backend.close(resolve))
  })
  return { gateway, port, url: `http://127.0.0.1:${port}` }
}

test('closing waits for an accepted write and preserves its response', async (t) => {
  let received
  let finishWrite
  const started = new Promise((resolve) => { received = resolve })
  const allowed = new Promise((resolve) => { finishWrite = resolve })
  let committed = false
  const { gateway, url } = await fixture(t, async (_request, response) => {
    received()
    await allowed
    committed = true
    response.end('saved')
  })
  const saved = fetch(url, { method: 'POST', body: 'fictional transaction' }).then((r) => r.text())
  await started
  let stopped = false
  const closing = gateway.close().then(() => { stopped = true })
  await delay(30)
  assert.equal(stopped, false)
  assert.equal(gateway.activeRequests, 1)
  finishWrite()
  assert.equal(await saved, 'saved')
  await closing
  assert.equal(committed, true)
})

test('a disconnected window does not cut off an upstream write during shutdown', async (t) => {
  let received
  let finishWrite
  const started = new Promise((resolve) => { received = resolve })
  const allowed = new Promise((resolve) => { finishWrite = resolve })
  let committed = false
  const { gateway, port } = await fixture(t, async (incoming, response) => {
    incoming.resume()
    await once(incoming, 'end')
    received()
    await allowed
    committed = true
    response.end('saved')
  })
  const client = request({ hostname: '127.0.0.1', port, method: 'POST' })
  client.on('error', () => {})
  client.end('fictional transaction')
  await started
  client.destroy()
  let stopped = false
  const closing = gateway.close().then(() => { stopped = true })
  await delay(30)
  assert.equal(stopped, false)
  assert.equal(gateway.activeRequests, 1)
  finishWrite()
  await closing
  assert.equal(committed, true)
})

test('the gateway rejects foreign origins, rebound hosts and local dev control routes', async (t) => {
  let backendRequests = 0
  const { url } = await fixture(t, (_request, response) => {
    backendRequests += 1
    response.end('ledger')
  })
  assert.equal((await fetch(url, { headers: { Origin: 'https://untrusted.example' } })).status, 403)
  assert.equal((await fetch(`${url}/cdn-cgi/local/explorer/api/d1/database`)).status, 404)
  const rebound = await new Promise((resolve, reject) => {
    const client = request(url, { headers: { Host: 'untrusted.example' } }, (response) => {
      response.resume()
      resolve(response.statusCode)
    })
    client.on('error', reject)
    client.end()
  })
  assert.equal(rebound, 403)
  assert.equal(backendRequests, 0)
  assert.equal(await (await fetch(url)).text(), 'ledger')
})

test('a port conflict leaves the existing server running', async (t) => {
  const original = createServer((_request, response) => response.end('original'))
  const port = await listen(original)
  t.after(() => original.close())
  const gateway = createLedgerGateway(port)
  await assert.rejects(gateway.listen(), { code: 'EADDRINUSE' })
  await gateway.close()
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'original')
  original.closeAllConnections()
})

test('stopping an owned process group stops its child processes', async () => {
  const child = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process')
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    console.log(grandchild.pid)
    setInterval(() => {}, 1000)
  `], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
  const [data] = await once(child.stdout, 'data')
  const grandchildPid = Number(data.toString().trim())
  try {
    assert.ok(grandchildPid > 1)
    await stopOwnedProcessGroup(child)
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { process.kill(grandchildPid, 0) } catch (error) {
        assert.equal(error.code, 'ESRCH')
        return
      }
      await delay(20)
    }
    assert.fail('Grandchild process survived application shutdown')
  } finally {
    await stopOwnedProcessGroup(child)
  }
})
