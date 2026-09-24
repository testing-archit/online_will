import { createApiServer } from '../server/app.mjs'

/**
 * server/app.mjs's `createApiServer()` (the real, unchanged Node http.Server -- same code, same test suite) runs
 * here, but bound only to 127.0.0.1 on an OS-assigned port, never reached directly by nginx or the internet --
 * only this process's own Next.js route handler talks to it. This replaced an earlier attempt to emulate
 * `IncomingMessage`/`ServerResponse` well enough to drive `handleRequest()` directly: that broke on the file-
 * download route, where `pipeline()`'s own completion semantics depend on a real socket's flush/finish behavior
 * in ways that proved impractical to fake correctly. Real sockets, even if both ends live in this one process,
 * sidestep that class of bug entirely -- and this still means one process, one systemd unit, one port exposed to
 * the outside world, which is what "no separate server" was actually for operationally.
 */
let portPromise: Promise<number> | undefined

function startInternalApiServer(): Promise<number> {
  portPromise ??= new Promise((resolve, reject) => {
    const server = createApiServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Internal API server did not report a port'))
        return
      }
      resolve(address.port)
    })
  })
  return portPromise
}

export async function internalApiBaseUrl(): Promise<string> {
  const port = await startInternalApiServer()
  return `http://127.0.0.1:${port}`
}
