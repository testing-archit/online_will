import { AlertTriangle, CalendarClock, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { listAssets, mapAssetsToBeneficiaries } from '../../lib/assetMapping'
import { scheduleReminder } from '../../lib/backendClient'
import {
  annualReviewDue,
  canAdvanceTo,
  createAnnualReviewEvent,
  createEventReview,
  EVENT_REVIEW_PRESETS,
  looksLikeSecret,
  postDeathSteps,
  reviewReminderEmail,
  reviewRunAt,
} from '../../lib/estateOs'
import { newId } from '../../lib/id'
import type { EstateReviewEvent, PostDeathWorkflowStatus, WillData } from '../../lib/types'
import { Field, TextArea, TextInput } from '../fields'
import { InlineAction, OsPanel } from './OsUi'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const POST_DEATH_DETAIL: Record<PostDeathWorkflowStatus, string> = {
  not_started: 'No action has been taken.',
  death_reported: 'The death has been reported to the executor / Octaraa.',
  executor_authenticated: 'The executor\'s identity and authority have been verified by a person (documents checked). This app cannot verify identity by itself.',
  inventory_review: 'The estate inventory below is reviewed against reality.',
  distribution_tracking: 'Distribution to beneficiaries is tracked and closed out.',
}

export function LegacyPanel() {
  const { watch, setValue, getValues } = useFormContext<WillData>()
  const data = watch()
  const [asset, setAsset] = useState({ accountType: '', provider: '', locationHint: '', instruction: '' })
  const [assetError, setAssetError] = useState('')
  const [reviewTrigger, setReviewTrigger] = useState('')
  const [reminderNote, setReminderNote] = useState('')
  const [postDeathNote, setPostDeathNote] = useState('')
  const [postDeathExecutor, setPostDeathExecutor] = useState('')

  // ---------------------------------------------------------- digital assets
  function addDigitalAsset() {
    if (!asset.accountType.trim() && !asset.provider.trim()) return
    // Task 33 — never store credentials. Describe WHERE things are and who should act.
    if ([asset.locationHint, asset.instruction, asset.provider, asset.accountType].some(looksLikeSecret)) {
      return setAssetError('That looks like a password, PIN, seed phrase or key. Do not store credentials here — say where they are kept (for example a sealed envelope or password manager) and who should access them.')
    }
    setAssetError('')
    setValue('estateOs.digitalAssets', [{ id: newId(), ...asset }, ...getValues().estateOs.digitalAssets], { shouldDirty: true })
    setAsset({ accountType: '', provider: '', locationHint: '', instruction: '' })
  }

  // ----------------------------------------------------------------- reviews
  async function scheduleFor(event: EstateReviewEvent) {
    const email = getValues().estateOs.reminderEmail.trim()
    if (!EMAIL_PATTERN.test(email)) return false
    const content = reviewReminderEmail(event.trigger, event.dueDate)
    return scheduleReminder({ runAt: reviewRunAt(event.dueDate), to: email, kind: 'estate-review', ...content })
  }

  async function addReview(event: EstateReviewEvent) {
    const scheduled = await scheduleFor(event)
    setValue('estateOs.reviewEvents', [{ ...event, reminderScheduled: scheduled }, ...getValues().estateOs.reviewEvents], { shouldDirty: true })
    setReminderNote(
      scheduled
        ? `Reminder scheduled for ${event.dueDate} at 09:00.`
        : EMAIL_PATTERN.test(getValues().estateOs.reminderEmail.trim())
          ? 'Review added, but the reminder could not be scheduled (server unreachable).'
          : 'Review added. Enter an email address to also receive a reminder.',
    )
  }

  function setReviewStatus(id: string, status: EstateReviewEvent['status']) {
    setValue('estateOs.reviewEvents', getValues().estateOs.reviewEvents.map((item) => (item.id === id ? { ...item, status } : item)), { shouldDirty: true })
  }

  // ---------------------------------------------------------------- post-death
  const steps = postDeathSteps()
  const current = data.estateOs.postDeathWorkflowStatus
  const nextStep = steps[steps.indexOf(current) + 1]
  const primaryExecutors = data.executorsGuardians.executors.filter((executor) => executor.fullName.trim())

  function advance(target: PostDeathWorkflowStatus) {
    if (!canAdvanceTo(current, target)) return
    if (target === 'executor_authenticated' && !postDeathExecutor) return
    if (target !== 'not_started' && !window.confirm(`Confirm: "${target.replaceAll('_', ' ')}". ${POST_DEATH_DETAIL[target]}`)) return
    const note = target === 'executor_authenticated' ? `Executor: ${postDeathExecutor}. ${postDeathNote}`.trim() : postDeathNote.trim()
    setValue('estateOs.postDeathWorkflowStatus', target, { shouldDirty: true })
    setValue('estateOs.postDeathWorkflowLog', [{ id: newId(), status: target, at: new Date().toISOString(), note }, ...getValues().estateOs.postDeathWorkflowLog], { shouldDirty: true })
    setPostDeathNote('')
  }

  const inventory = mapAssetsToBeneficiaries(data)
  const totalValue = listAssets(data).reduce((sum, item) => sum + (item.value ?? 0), 0)

  return (
    <OsPanel icon={CalendarClock} title="Legacy vault: digital assets, estate reviews and executor workflow">
      <h4 className="text-sm font-semibold text-slate-800">Digital assets and accounts</h4>
      <p className="mb-2 mt-1 text-xs text-slate-500">Record where accounts are and what the executor should do — never passwords, PINs, seed phrases or keys (keep those in a separate sealed memorandum).</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <TextInput placeholder="Account type" aria-label="Account type" value={asset.accountType} onChange={(event) => setAsset({ ...asset, accountType: event.target.value })} />
        <TextInput placeholder="Provider" aria-label="Provider" value={asset.provider} onChange={(event) => setAsset({ ...asset, provider: event.target.value })} />
        <TextInput placeholder="Where credentials are kept (no passwords)" aria-label="Location hint" value={asset.locationHint} onChange={(event) => setAsset({ ...asset, locationHint: event.target.value })} />
        <button type="button" onClick={addDigitalAsset} className="rounded-xl bg-brand-primary px-3 py-2 text-sm font-semibold text-white">Add digital asset</button>
      </div>
      <TextArea className="mt-3" placeholder="Instruction for the executor, without storing passwords" aria-label="Instruction" value={asset.instruction} onChange={(event) => setAsset({ ...asset, instruction: event.target.value })} />
      {assetError && (
        <p className="mt-2 flex items-start gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {assetError}
        </p>
      )}
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {data.estateOs.digitalAssets.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <span>
              {item.accountType || 'Digital account'} · {item.provider || 'Provider not specified'} · {item.locationHint || 'No location hint'}
              {item.instruction && <span className="block text-xs text-slate-500">{item.instruction}</span>}
            </span>
            <button type="button" aria-label="Remove digital asset" onClick={() => setValue('estateOs.digitalAssets', getValues().estateOs.digitalAssets.filter((entry) => entry.id !== item.id), { shouldDirty: true })}>
              <Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-rose-600" />
            </button>
          </li>
        ))}
      </ul>

      <h4 className="mt-6 text-sm font-semibold text-slate-800">Estate reviews and reminders</h4>
      {annualReviewDue(data) && <p className="mt-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">It has been over 12 months since your last completed estate review. Schedule the next one below.</p>}
      <div className="mt-2 max-w-md">
        <Field label="Email reminders to" hint="Reminders are sent at 09:00 on the due date.">
          <TextInput type="email" value={data.estateOs.reminderEmail} onChange={(event) => setValue('estateOs.reminderEmail', event.target.value, { shouldDirty: true })} placeholder="you@example.com" />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void addReview(createAnnualReviewEvent())} className="rounded-full border border-brand-secondary px-4 py-2 text-sm font-semibold text-brand-secondary-ink">Schedule annual review</button>
      </div>
      <p className="mb-1 mt-3 text-xs text-slate-500">Something changed? Confirm the event and we'll queue a review:</p>
      <div className="flex flex-wrap gap-1.5">
        {EVENT_REVIEW_PRESETS.map((preset) => (
          <button key={preset} type="button" onClick={() => void addReview(createEventReview(preset))} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-brand-secondary">{preset}</button>
        ))}
      </div>
      <div className="mt-2">
        <InlineAction label="Custom event" value={reviewTrigger} onChange={setReviewTrigger} onClick={() => { void addReview(createEventReview(reviewTrigger.trim())); setReviewTrigger('') }} placeholder="Other event that changes your estate" button="Add event review" compact />
      </div>
      {reminderNote && <p className="mt-2 text-xs text-slate-600" role="status">{reminderNote}</p>}
      <ul className="mt-3 space-y-2">
        {data.estateOs.reviewEvents.length === 0 && <li className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400">Review reminders will appear here.</li>}
        {data.estateOs.reviewEvents.map((event) => (
          <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
            <span className={`text-sm ${event.status === 'pending' ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
              {event.trigger}
              <span className="ml-2 text-xs text-slate-500 no-underline">due {event.dueDate}{event.reminderScheduled ? ' · reminder queued' : ''}</span>
            </span>
            {event.status === 'pending' ? (
              <span className="flex gap-1.5">
                <button type="button" onClick={() => setReviewStatus(event.id, 'completed')} className="rounded-full border border-emerald-200 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">Complete</button>
                <button type="button" onClick={() => setReviewStatus(event.id, 'dismissed')} className="rounded-full border border-slate-200 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500">Dismiss</button>
              </span>
            ) : (
              <span className="text-[11px] font-semibold uppercase text-slate-400">{event.status}</span>
            )}
          </li>
        ))}
      </ul>

      <h4 className="mt-6 text-sm font-semibold text-slate-800">Post-death executor workflow</h4>
      <p className="mb-2 mt-1 text-xs text-slate-500">Steps must be taken in order and each is confirmed and logged. Identity checks are done by a person; this app only records them.</p>
      <ol className="space-y-1.5">
        {steps.map((step, index) => {
          const done = index <= steps.indexOf(current)
          return (
            <li key={step} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${done ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-100 bg-white text-slate-500'}`}>
              <span className="w-5 text-xs font-semibold">{index + 1}.</span>
              <span className="capitalize">{step.replaceAll('_', ' ')}</span>
              {step === current && <span className="ml-auto text-[11px] font-semibold uppercase text-emerald-700">current</span>}
            </li>
          )
        })}
      </ol>
      {nextStep && (
        <div className="mt-2 space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
          {nextStep === 'executor_authenticated' && (
            <select value={postDeathExecutor} onChange={(event) => setPostDeathExecutor(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" aria-label="Executor who was verified">
              <option value="">Select the executor whose identity was verified…</option>
              {primaryExecutors.map((executor) => <option key={executor.id} value={executor.fullName}>{executor.fullName}{executor.isAlternate ? ' (alternate)' : ''}</option>)}
            </select>
          )}
          <TextInput value={postDeathNote} onChange={(event) => setPostDeathNote(event.target.value)} placeholder="Note (e.g. death certificate no., who verified)" aria-label="Workflow note" />
          <button type="button" onClick={() => advance(nextStep)} disabled={nextStep === 'executor_authenticated' && !postDeathExecutor} className="rounded-full bg-brand-primary px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
            Confirm: {nextStep.replaceAll('_', ' ')}
          </button>
        </div>
      )}
      {current !== 'not_started' && (
        <button type="button" onClick={() => advance('not_started')} className="mt-2 text-[11px] font-semibold text-slate-400 underline-offset-2 hover:text-rose-600 hover:underline">Reset workflow</button>
      )}
      {(current === 'inventory_review' || current === 'distribution_tracking') && (
        <div className="mt-3 rounded-xl border border-slate-100 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Estate inventory{totalValue > 0 ? ` · recorded value ${totalValue.toLocaleString('en-IN')}` : ''}</p>
          <ul className="mt-1 space-y-1">
            {inventory.map(({ asset: item, targets }) => (
              <li key={item.id} className="text-xs text-slate-700">{item.title} <span className="text-slate-400">→ {targets.map((target) => target.name).join(', ') || 'no recipient recorded'}</span></li>
            ))}
            {data.assets.hasEncumberedAssets && <li className="text-xs text-amber-700">Liabilities: {data.assets.encumbranceDetails || 'details not recorded'}</li>}
          </ul>
        </div>
      )}
      {data.estateOs.postDeathWorkflowLog.length > 0 && (
        <ul className="mt-3 space-y-1">
          {data.estateOs.postDeathWorkflowLog.slice(0, 6).map((entry) => (
            <li key={entry.id} className="text-[11px] text-slate-500">{new Date(entry.at).toLocaleString()} — <span className="capitalize">{entry.status.replaceAll('_', ' ')}</span>{entry.note ? ` · ${entry.note}` : ''}</li>
          ))}
        </ul>
      )}
    </OsPanel>
  )
}
