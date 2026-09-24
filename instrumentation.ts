/**
 * Runs once when the Next.js server process starts -- the App Router equivalent of what server/server.mjs used to
 * do at module load: refuse to boot with a weak session secret in production, and start the notification
 * scheduler's setInterval loop. Next's own instrumentation hook (rather than a custom server entrypoint) is the
 * supported way to do this in a long-running, self-hosted `next start` process.
 */
export async function register() {
  // Only in the real Node server runtime -- this file is also evaluated for the (unused here) edge runtime,
  // where these Node-specific modules don't exist.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { assertAuthConfig } = await import('./server/auth.mjs')
  const { startScheduler } = await import('./server/scheduler.mjs')

  assertAuthConfig()
  startScheduler()
}
