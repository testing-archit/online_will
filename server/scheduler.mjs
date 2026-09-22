import { sendBrevoEmail, sendBrevoSms } from './brevo.mjs'
import { listRecords, upsertRecord } from './store.mjs'

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
  // A slow provider must not cause overlapping runs that send the same job twice.
  if (running) return { skipped: true }
  running = true
  try {
    const now = Date.now()
    const due = await listRecords(
      'notificationJobs',
      (job) => job.status === 'scheduled' && (!job.runAt || Date.parse(job.runAt) <= now),
    )

    const summary = { sent: 0, failed: 0, retrying: 0 }
    for (const job of due) {
      // Claim the job first so a crash mid-send cannot leave it eligible for a duplicate send.
      await upsertRecord('notificationJobs', { id: job.id, status: 'sending' }, 'scheduler')
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
