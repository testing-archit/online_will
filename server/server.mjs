import { createApiServer } from './app.mjs'
import { assertAuthConfig } from './auth.mjs'
import { startScheduler } from './scheduler.mjs'

assertAuthConfig()
startScheduler()

const port = Number.parseInt(process.env.API_PORT || '8787', 10)
// Loopback by default; set API_HOST=0.0.0.0 explicitly when deploying behind a proxy.
const host = process.env.API_HOST || '127.0.0.1'

createApiServer().listen(port, host, () => {
  console.log(`Octaraa API gateway listening on http://${host}:${port}`)
})
