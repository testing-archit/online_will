// Error reporting for genuinely unexpected server errors (never for ordinary httpError() responses, which are
// expected 4xx/well-known failures). Always logs; additionally reports to Sentry only when SENTRY_DSN is set --
// so this is a no-op behavior change from plain console.error until an operator deliberately configures it.

let sentryClient

async function getSentryClient() {
  if (!process.env.SENTRY_DSN) return null
  sentryClient ??= import('@sentry/node').then((Sentry) => {
    Sentry.init({ dsn: process.env.SENTRY_DSN })
    return Sentry
  })
  return sentryClient
}

export async function reportError(error) {
  console.error(error)
  try {
    const Sentry = await getSentryClient()
    Sentry?.captureException(error)
  } catch {
    // Sentry itself failing to load/report must never take down error handling.
  }
}
