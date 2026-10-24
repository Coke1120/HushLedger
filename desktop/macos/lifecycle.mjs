import { createServer, request } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

// Count upstream completion, including requests whose browser window has closed.
// Closing the window must not interrupt a transaction already being committed.
export function createLedgerGateway(port = 8787) {
  let backendPort
  let closing = false
  let active = 0
  let drained
  const host = `127.0.0.1:${port}`
  const server = createServer((incoming, outgoing) => {
    if (incoming.headers.host !== host
      || (incoming.headers.origin && incoming.headers.origin !== `http://${host}`)) {
      outgoing.writeHead(403).end()
      return
    }
    if (!incoming.url?.startsWith('/') || incoming.url.startsWith('/cdn-cgi/local/')) {
      outgoing.writeHead(404).end()
      return
    }
    if (closing || !backendPort) {
      outgoing.writeHead(503, { 'cache-control': 'no-store', connection: 'close' }).end()
      return
    }
    active += 1
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      active -= 1
      if (active === 0) drained?.()
    }
    const upstream = request({
      hostname: '127.0.0.1', port: backendPort, method: incoming.method,
      path: incoming.url, headers: { ...incoming.headers, host },
    }, (response) => {
      response.once('end', finish)
      response.once('close', finish)
      response.once('error', finish)
      if (!outgoing.destroyed) {
        outgoing.writeHead(response.statusCode ?? 502, response.headers)
        response.pipe(outgoing)
      } else response.resume()
      outgoing.once('close', () => response.resume())
    })
    upstream.once('error', () => {
      finish()
      if (!outgoing.headersSent) outgoing.writeHead(502)
      outgoing.end()
    })
    incoming.once('aborted', () => upstream.destroy())
    incoming.pipe(upstream)
  })
  server.on('clientError', (_error, socket) => socket.destroy())
  server.on('upgrade', (_request, socket) => socket.destroy())
  return {
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', resolve)
      })
    },
    setBackend(value) { backendPort = value },
    get activeRequests() { return active },
    async close() {
      closing = true
      const closed = new Promise((resolve) => server.close(resolve))
      server.closeIdleConnections()
      if (active > 0) await new Promise((resolve) => { drained = resolve })
      server.closeAllConnections()
      await closed
    },
  }
}

function groupExists(pid) {
  try { process.kill(-pid, 0); return true } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

function signalGroup(pid, signal) {
  try { process.kill(-pid, signal) } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

// The caller must have created this group with spawn({ detached: true }).
export async function stopOwnedProcessGroup(child) {
  if (!child?.pid || !groupExists(child.pid)) return
  signalGroup(child.pid, 'SIGINT')
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!groupExists(child.pid)) return
    await delay(100)
  }
  if (groupExists(child.pid)) signalGroup(child.pid, 'SIGKILL')
}
