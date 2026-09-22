import { motion } from 'framer-motion'
import { AlertTriangle, BookOpenCheck, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useFormContext } from 'react-hook-form'
import {
  answerLegalQuestionWithBackend,
  currentServerWillId,
  saveWillToBackend,
  sendNotificationJobs,
  submitConsultation,
  type NotificationResult,
} from '../../lib/backendClient'
import { detectEstateIssues } from '../../lib/estateIssues'
import { newId } from '../../lib/id'
import { answerFromKnowledgeBase } from '../../lib/legalKnowledge'
import { computeLegalFlags } from '../../lib/legalRules'
import { buildNotificationWorkflow, type NotificationJob } from '../../lib/notificationWorkflow'
import { saveConsultationRequest } from '../../lib/storage'
import type { ConsultationRequest, WillData } from '../../lib/types'
import { Callout, Field, SelectInput, TextArea, TextInput } from '../fields'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const REPORT_FOR_JOB: Record<string, 'client' | 'advisor' | 'lawyer'> = {
  'submission-confirmation-client': 'client',
  'advisor-report-ready': 'advisor',
  'lawyer-review-required': 'lawyer',
}

type DeliveryState = { status: 'idle' } | { status: 'sending' } | { status: 'done'; results: NotificationResult[] | null; savedToServer: boolean }

export function ConsultationStep() {
  const { watch, setValue, getValues } = useFormContext<WillData>()
  const data = watch()
  const [legalQuestion, setLegalQuestion] = useState('')
  const [isAnswering, setIsAnswering] = useState(false)

  async function askLegalAssistant() {
    const question = legalQuestion.trim()
    if (!question) return
    setIsAnswering(true)
    try {
      // The server owns the approved knowledge base; the bundled copy is only the offline fallback.
      const backendAnswer = await answerLegalQuestionWithBackend(question)
      const local = answerFromKnowledgeBase(question)
      const answer = backendAnswer?.answer ?? local.answer
      const sources = backendAnswer?.sources ?? local.sources.map(({ id, title, citation }) => ({ id, title, citation }))

      setValue(
        'estateOs.legalKnowledgeHistory',
        [{ id: newId(), question, answer, sources, createdAt: new Date().toISOString() }, ...getValues().estateOs.legalKnowledgeHistory].slice(0, 30),
        { shouldDirty: true },
      )
      setLegalQuestion('')
    } finally {
      setIsAnswering(false)
    }
  }

  const flags = useMemo(() => computeLegalFlags(data), [data])
  const mandatoryIssues = useMemo(() => detectEstateIssues(data).filter((issue) => issue.severity === 'mandatory'), [data])
  const criticalFlags = flags.filter((flag) => flag.severity === 'critical')

  const [form, setForm] = useState({
    contactName: data.personal.fullLegalName ?? '',
    contactPhone: '',
    contactEmail: '',
    preferredMode: '' as ConsultationRequest['preferredMode'],
    preferredWindow: '',
    notes: '',
  })
  const [submitted, setSubmitted] = useState<ConsultationRequest | null>(null)
  const [delivery, setDelivery] = useState<DeliveryState>({ status: 'idle' })
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)

  const emailError = form.contactEmail && !EMAIL_PATTERN.test(form.contactEmail) ? 'Enter a valid email address.' : undefined
  const phoneError = form.contactPhone && form.contactPhone.replace(/\D/g, '').length < 8 ? 'Enter a valid phone number.' : undefined
  const canSubmit = mandatoryIssues.length === 0 && Boolean(form.contactName.trim()) && (Boolean(form.contactPhone) || Boolean(form.contactEmail)) && !emailError && !phoneError

  async function handleDownloadPdf(consultation?: ConsultationRequest | null) {
    setIsGeneratingPdf(true)
    try {
      const { downloadWillPdf } = await import('../../pdf/generatePdf')
      await downloadWillPdf(getValues(), consultation)
    } finally {
      setIsGeneratingPdf(false)
    }
  }

  /** Save the Will, register the consultation, generate the three reports and email each to its audience. */
  async function distribute(request: ConsultationRequest) {
    setDelivery({ status: 'sending' })
    const current = getValues()

    const saved = await saveWillToBackend(current)
    const willId = saved.id ?? currentServerWillId()
    const savedToServer = saved.status === 'saved'
    await submitConsultation(request, willId)

    const jobs = buildNotificationWorkflow(current, request)
    let jobsWithReports: NotificationJob[] = jobs
    try {
      const { renderEstateReportAttachment } = await import('../../pdf/generatePdf')
      jobsWithReports = await Promise.all(
        jobs.map(async (job) => {
          const type = REPORT_FOR_JOB[job.id]
          return type ? { ...job, attachment: await renderEstateReportAttachment(current, type) } : job
        }),
      )
    } catch {
      // Reports failing to render must not block the notifications themselves.
    }

    const results = await sendNotificationJobs(jobsWithReports, request.contactEmail, request.id)
    setDelivery({ status: 'done', results, savedToServer })
  }

  async function submit() {
    if (!canSubmit) return
    const request: ConsultationRequest = {
      id: newId(),
      createdAt: new Date().toISOString(),
      ...form,
      contactName: form.contactName.trim(),
      contactEmail: form.contactEmail.trim(),
      flagsSnapshot: flags,
    }
    saveConsultationRequest(request)
    setSubmitted(request)
    await distribute(request)
  }

  if (submitted) {
    const notificationJobs = buildNotificationWorkflow(data, submitted)
    const results = delivery.status === 'done' ? delivery.results : null
    const statusOf = (jobId: string) => results?.find((result) => result.jobId === jobId)
    const failed = results?.some((result) => result.status === 'failed') ?? false

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-10 text-center"
      >
        <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}>
          <CheckCircle2 className="h-14 w-14 text-emerald-500" strokeWidth={1.5} />
        </motion.div>
        <h3 className="mt-4 text-lg font-semibold text-emerald-900">Consultation request received</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-emerald-800">
          We've logged your request{submitted.preferredWindow ? ` for ${submitted.preferredWindow}` : ''}. A qualified lawyer will review your {flags.length} flagged item
          {flags.length === 1 ? '' : 's'}
          {criticalFlags.length > 0 ? `, including ${criticalFlags.length} that need resolving before you sign` : ''}, and reach out at{' '}
          {submitted.contactPhone || submitted.contactEmail || 'the contact you provided'}.
        </p>
        <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-emerald-700/80">
          Nothing here is legally binding yet — your Will is only executed once you print it, sign it in front of two witnesses, and (optionally, or mandatorily in
          Uttarakhand) register it.
        </p>
        <motion.button
          type="button"
          onClick={() => void handleDownloadPdf(submitted)}
          disabled={isGeneratingPdf}
          whileHover={isGeneratingPdf ? undefined : { scale: 1.02 }}
          whileTap={isGeneratingPdf ? undefined : { scale: 0.98 }}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand-primary/30 transition hover:bg-brand-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isGeneratingPdf ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Generating…
            </>
          ) : (
            <>
              <Download className="h-4 w-4" /> Download full report (PDF)
            </>
          )}
        </motion.button>

        <div className="mt-6 w-full max-w-2xl rounded-2xl border border-emerald-200 bg-white/70 p-4 text-left">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-emerald-950">
              {delivery.status === 'sending' ? 'Sending notifications and reports…' : 'Notification workflow'}
            </h4>
            {delivery.status === 'sending' && <Loader2 className="h-4 w-4 animate-spin text-emerald-700" />}
            {delivery.status === 'done' && (failed || results === null) && (
              <button
                type="button"
                onClick={() => void distribute(submitted)}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-800"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            )}
          </div>
          {delivery.status === 'done' && (
            <p className="mt-1 text-xs text-emerald-800">
              {delivery.savedToServer ? 'Your Will was saved to your case.' : 'Your Will is saved on this device; the server copy could not be updated.'}{' '}
              {results === null && 'The notification service could not be reached — use Retry, or your request is still logged locally.'}
            </p>
          )}
          <div className="mt-3 space-y-2">
            {notificationJobs.map((job) => {
              const result = statusOf(job.id)
              return (
                <div key={job.id} className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      {job.audience} · {job.templateId}
                    </p>
                    {result && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          result.status === 'sent' ? 'bg-emerald-200 text-emerald-900' : result.status === 'failed' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {result.status === 'failed' && <AlertTriangle className="h-3 w-3" />}
                        {result.status}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-medium text-emerald-950">{job.subject}</p>
                  <p className="mt-0.5 text-xs text-emerald-800">{job.preview}</p>
                  {result?.reason && <p className="mt-0.5 text-[11px] text-slate-500">{result.reason}</p>}
                </div>
              )
            })}
          </div>
        </div>
      </motion.div>
    )
  }

  return (
    <div className="space-y-5">
      <Callout tone={criticalFlags.length > 0 ? 'critical' : 'info'}>
        {criticalFlags.length > 0
          ? `${criticalFlags.length} item(s) need a lawyer's input before this draft is ready to print and sign.`
          : 'No blocking issues detected — a consultation is still recommended before you finalize and sign.'}
      </Callout>

      {mandatoryIssues.length > 0 && (
        <Callout tone="critical" title="Complete mandatory items before submission">
          {mandatoryIssues.length} required item{mandatoryIssues.length === 1 ? '' : 's'} still need an answer. You can still review reports, but the consultation
          workflow is locked until mandatory information is complete:
          <ul className="mt-1 list-disc pl-5">
            {mandatoryIssues.slice(0, 6).map((issue) => (
              <li key={issue.id}>{issue.title}</li>
            ))}
            {mandatoryIssues.length > 6 && <li>…and {mandatoryIssues.length - 6} more</li>}
          </ul>
        </Callout>
      )}

      <Field label="Your name">
        <TextInput value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phone" error={phoneError}>
          <TextInput type="tel" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
        </Field>
        <Field label="Email" error={emailError} hint="Your reports are emailed here.">
          <TextInput type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
        </Field>
      </div>
      <Field label="Preferred consultation mode">
        <SelectInput value={form.preferredMode} onChange={(e) => setForm({ ...form, preferredMode: e.target.value as ConsultationRequest['preferredMode'] })}>
          <option value="">Select</option>
          <option value="video">Video call</option>
          <option value="phone">Phone call</option>
          <option value="in-person">In person</option>
        </SelectInput>
      </Field>
      <Field label="Preferred date/time window">
        <TextInput value={form.preferredWindow} onChange={(e) => setForm({ ...form, preferredWindow: e.target.value })} placeholder="e.g. Weekday evenings this week" />
      </Field>
      <Field label="Anything else the lawyer should know?">
        <TextArea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <BookOpenCheck className="h-4 w-4 text-brand-primary" />
          <h3 className="text-sm font-semibold text-slate-900">Legal knowledge assistant</h3>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Answers come only from the approved Octaraa legal knowledge base, with sources cited. This is general information, not legal advice.
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <TextInput
            value={legalQuestion}
            onChange={(event) => setLegalQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void askLegalAssistant()
              }
            }}
            placeholder="e.g. Can a witness also be a beneficiary?"
            aria-label="Ask a legal question"
          />
          <button
            type="button"
            onClick={() => void askLegalAssistant()}
            disabled={isAnswering || !legalQuestion.trim()}
            className="rounded-xl bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {isAnswering ? 'Checking sources…' : 'Ask'}
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {data.estateOs.legalKnowledgeHistory.slice(0, 3).map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-sm font-semibold text-slate-800">{item.question}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{item.answer}</p>
              {item.sources.length > 0 && <p className="mt-1 text-[11px] font-medium text-slate-400">Sources: {item.sources.map((source) => source.citation).join(' · ')}</p>}
            </div>
          ))}
        </div>
      </section>

      <motion.button
        type="button"
        onClick={() => void submit()}
        disabled={!canSubmit}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
        className="w-full rounded-full bg-brand-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        Request consultation
      </motion.button>
    </div>
  )
}
