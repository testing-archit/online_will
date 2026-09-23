import { sendBrevoEmail, sendBrevoSms } from './brevo.mjs'
import { claimDueJobs, upsertRecord } from './store.mjs'

const MAX_ATTEMPTS = 3
let running = false

export function startScheduler() {
  if (process.env.SCHEDULER_ENABLED !== 'true') return

  const intervalMs = Number.parseInt(process.env.SCHEDULER_INTERVAL_MS || '60000', 10)
  const tick = () =>
    runScheduledJobs().catch((error) => console.error(`Scheduler run failed: ${error.message}`))
  setInterval(tick, intervalMs).unref()
  void tick()
}

export async function runScheduledJobs() {
  // A slow provider must not cause overlapping runs that send the same job twice within this process; claimDueJobs
  // itself is atomic (a single locked queue task, or a single SQL statement on Postgres), so this is also safe
  // across multiple processes/instances when DATABASE_URL is set.
  if (running) return { skipped: true }
  running = true
  try {
    const due = await claimDueJobs()

    const summary = { sent: 0, failed: 0, retrying: 0 }
    for (const job of due) {
      const attempts = (job.attempts ?? 0) + 1
      try {
        if (job.channel === 'sms') await sendBrevoSms(job.message)
        else await sendBrevoEmail(job.message)
        await upsertRecord(
          'notificationJobs',
          { id: job.id, status: 'sent', attempts, sentAt: new Date().toISOString(), lastError: '' },
          'scheduler',
        )
        summary.sent += 1
      } catch (error) {
        const exhausted = attempts >= MAX_ATTEMPTS
        await upsertRecord(
          'notificationJobs',
          {
            id: job.id,
            status: exhausted ? 'failed' : 'scheduled',
            attempts,
            lastError: error instanceof Error ? error.message : 'Unknown error',
            // Back off before the next attempt.
            runAt: exhausted ? job.runAt : new Date(Date.now() + attempts * 5 * 60_000).toISOString(),
          },
          'scheduler',
        )
        summary[exhausted ? 'failed' : 'retrying'] += 1
      }
    }
    return summary
  } finally {
    running = false
  }
}
