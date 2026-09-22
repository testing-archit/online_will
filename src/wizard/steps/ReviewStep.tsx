import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, ChevronDown, CircleAlert, Download, FileText, Loader2, Pencil } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { generateDraftText } from '../../lib/draftText'
import { detectEstateIssues } from '../../lib/estateIssues'
import { computeLegalFlags, flagCounts } from '../../lib/legalRules'
import { getAnswerReview } from '../../lib/questionnaireSchema'
import type { FlagSeverity, WillData } from '../../lib/types'
import type { EstateReportType } from '../../pdf/EstateReportDocument'
import { Callout } from '../fields'
import { useWizardNavigation } from '../navigation'

const SEVERITY_LABEL: Record<FlagSeverity, string> = {
  critical: 'Needs legal review before signing',
  warning: 'Worth clarifying',
  info: 'Good to know',
}

const STAT_STYLE: Record<FlagSeverity, { tile: string; number: string; label: string }> = {
  critical: { tile: 'border-rose-200 bg-rose-50', number: 'text-rose-600', label: 'Need legal review' },
  warning: { tile: 'border-amber-200 bg-amber-50', number: 'text-amber-600', label: 'Worth clarifying' },
  info: { tile: 'border-sky-200 bg-sky-50', number: 'text-sky-600', label: 'Informational' },
}

export function ReviewStep() {
  const { watch } = useFormContext<WillData>()
  const data = watch()
  const flags = useMemo(() => computeLegalFlags(data), [data])
  const counts = flagCounts(flags)
  const draft = useMemo(() => generateDraftText(data), [data])
  const answerReview = useMemo(() => getAnswerReview(data), [data])
  const mandatoryIssues = useMemo(() => detectEstateIssues(data).filter((issue) => issue.severity === 'mandatory'), [data])
  const { goToStep } = useWizardNavigation()
  const [showDraft, setShowDraft] = useState(false)
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [generatingReport, setGeneratingReport] = useState<EstateReportType | null>(null)

  async function handleDownloadPdf() {
    setIsGeneratingPdf(true)
    try {
      const { downloadWillPdf } = await import('../../pdf/generatePdf')
      await downloadWillPdf(data)
    } finally {
      setIsGeneratingPdf(false)
    }
  }

  async function handleDownloadReport(type: EstateReportType) {
    setGeneratingReport(type)
    try {
      const { downloadEstateReportPdf } = await import('../../pdf/generatePdf')
      await downloadEstateReportPdf(data, type)
    } finally {
      setGeneratingReport(null)
    }
  }

  return (
    <div className="space-y-7">
      <motion.button
        type="button"
        onClick={handleDownloadPdf}
        disabled={isGeneratingPdf}
        whileHover={isGeneratingPdf ? undefined : { scale: 1.01 }}
        whileTap={isGeneratingPdf ? undefined : { scale: 0.98 }}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-primary px-5 py-3.5 text-sm font-semibold text-white shadow-sm shadow-brand-primary/30 transition hover:bg-brand-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isGeneratingPdf ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Generating your PDF report…
          </>
        ) : (
          <>
            <Download className="h-4 w-4" /> Download full report (PDF)
          </>
        )}
      </motion.button>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['client', 'Client report'],
          ['advisor', 'Advisor report'],
          ['lawyer', 'Lawyer brief'],
        ].map(([type, label]) => (
          <motion.button
            key={type}
            type="button"
            onClick={() => handleDownloadReport(type as EstateReportType)}
            disabled={generatingReport !== null}
            whileHover={generatingReport ? undefined : { y: -1 }}
            whileTap={generatingReport ? undefined : { scale: 0.98 }}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-brand-secondary hover:text-brand-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generatingReport === type ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {label}
          </motion.button>
        ))}
      </div>

      {mandatoryIssues.length > 0 ? (
        <Callout tone="critical" title={`${mandatoryIssues.length} required answer${mandatoryIssues.length === 1 ? '' : 's'} must be completed before you can submit`}>
          <ul className="mt-1 list-disc pl-5">
            {mandatoryIssues.slice(0, 8).map((issue) => (
              <li key={issue.id}>{issue.title}</li>
            ))}
            {mandatoryIssues.length > 8 && <li>…and {mandatoryIssues.length - 8} more</li>}
          </ul>
        </Callout>
      ) : (
        <Callout tone="info">All required answers are complete. Review them below, then continue to submit.</Callout>
      )}

      <div className="grid grid-cols-3 gap-3">
        {(['critical', 'warning', 'info'] as FlagSeverity[]).map((severity, i) => (
          <motion.div
            key={severity}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.05 }}
            className={`rounded-2xl border px-3 py-4 text-center sm:px-4 ${STAT_STYLE[severity].tile}`}
          >
            <p className={`text-3xl font-semibold ${STAT_STYLE[severity].number}`} style={{ fontFamily: 'var(--font-display)' }}>
              {counts[severity]}
            </p>
            <p className="mt-1 text-xs font-medium text-slate-600">{STAT_STYLE[severity].label}</p>
          </motion.div>
        ))}
      </div>

      <div className="space-y-4">
        {(['critical', 'warning', 'info'] as FlagSeverity[]).map((severity) => {
          const items = flags.filter((f) => f.severity === severity)
          if (!items.length) return null
          return (
            <div key={severity}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {SEVERITY_LABEL[severity]}
              </h3>
              <div className="space-y-2">
                {items.map((flag) => (
                  <Callout key={flag.id} tone={severity}>
                    <p className="font-semibold">{flag.title}</p>
                    <p className="mt-0.5">{flag.description}</p>
                  </Callout>
                ))}
              </div>
            </div>
          )
        })}
        {flags.length === 0 && (
          <Callout tone="info">No issues detected yet — keep filling out the earlier steps.</Callout>
        )}
      </div>

      <section className="border-t border-slate-200 pt-5">
        <h3 className="mb-1 text-sm font-semibold text-slate-900">Review your answers</h3>
        <p className="mb-3 text-xs text-slate-500">This is exactly what you told us. Use Edit to change anything before you submit.</p>
        <div className="space-y-3">
          {answerReview.map((section) => (
            <div key={section.sectionId} className="rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  {section.completion === 100 ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <CircleAlert className="h-4 w-4 text-amber-500" />}
                  <h4 className="text-sm font-semibold text-slate-800">{section.title}</h4>
                  <span className="text-xs text-slate-400">{section.completion}%</span>
                </div>
                <button type="button" onClick={() => goToStep(section.sectionId)} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-brand-secondary hover:text-brand-secondary-ink">
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              </div>
              <dl className="divide-y divide-slate-50">
                {section.rows.map((row) => (
                  <div key={row.questionId} className="grid gap-1 px-4 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                    <dt className="text-slate-500">{row.label}{row.required && <span className="text-rose-500"> *</span>}</dt>
                    <dd className={row.answer ? 'break-words font-medium text-slate-800' : row.answered ? 'text-slate-400' : 'font-medium text-rose-600'}>
                      {row.answer || (row.answered ? 'Not provided (optional)' : 'Not answered')}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t border-slate-200 pt-5">
        <button
          type="button"
          onClick={() => setShowDraft((v) => !v)}
          className="inline-flex items-center gap-2 text-sm font-medium text-brand-primary transition hover:text-brand-primary-hover"
        >
          <FileText className="h-4 w-4" />
          {showDraft ? 'Hide' : 'Show'} draft document preview
          <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showDraft ? 'rotate-180' : ''}`} />
        </button>
        <AnimatePresence initial={false}>
          {showDraft && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800">
                {draft}
              </pre>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
