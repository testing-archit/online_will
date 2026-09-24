import { internalApiBaseUrl } from '../../../lib/apiServerInternal'

// One catch-all route for the entire /api/* surface: proxies to the real, unchanged server/app.mjs http.Server
// running internally on this same process (see lib/apiServerInternal.ts for why a real proxy, not an emulated
// request/response pair). request.body is passed through as a stream (not buffered) so uploads stream through
// without holding the whole file in memory, and the response is returned as-is (also unbuffered) so downloads
// stream back the same way.
async function handler(request: Request) {
  const base = await internalApiBaseUrl()
  const { pathname, search } = new URL(request.url)
  const upstream = await fetch(`${base}${pathname}${search}`, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    // @ts-expect-error -- required by undici when streaming a request body, not yet in the DOM lib types
    duplex: request.body ? 'half' : undefined,
  })
  return new Response(upstream.body, { status: upstream.status, headers: upstream.headers })
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const OPTIONS = handler
