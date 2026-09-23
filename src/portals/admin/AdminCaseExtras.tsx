import { Loader2, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toAiSnapshot } from '../../lib/aiSnapshot'
import { assignCase, listStaffAccounts, reviewCaseWithAi, type StaffAccount } from '../../lib/backendClient'
import { detectEstateIssues } from '../../lib/estateIssues'
import { computeLegalFlags } from '../../lib/legalRules'
import type { WillData } from '../../lib/types'
import { PortalCard } from '../shared'

/** Admin-only sidebar additions on the shared case-detail page: reassignment and the AI review assistant. */
export function AdminCaseExtras({ data, willId }: { data: WillData; willId: string }) {
  return (
    <>
      <AssignmentPanel willId={willId} />
      <AiReviewPanel data={data} willId={willId} />
    </>
  )
}

function AssignmentPanel({ willId }: { willId: string }) {
  const [staff, setStaff] = useState<StaffAccount[]>([])
  const [selected, setSelected] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listStaffAccounts().then((result) => {
      if (!cancelled) setStaff((result ?? []).filter((account) => account.role === 'lawyer' || account.role === 'advisor'))
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <PortalCard title="Assign">
      <div className="flex gap-2">
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-700 outline-none focus:border-brand-primary"
        >
          <option value="">Choose staff…</option>
          {staff.map((account) => (
            <option key={account.id} value={account.id}>
              {account.fullName} ({account.role})
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selected || assigning}
          onClick={async () => {
            setAssigning(true)
            setDone(await assignCase(willId, selected))
            setAssigning(false)
          }}
          className="shrink-0 rounded-lg bg-brand-primary px-3 text-xs font-semibold text-white disabled:opacity-50"
        >
          {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Assign'}
        </button>
      </div>
      {done && <p className="mt-2 text-xs text-emerald-600">Assigned.</p>}
    </PortalCard>
  )
}

function AiReviewPanel({ data, willId }: { data: WillData; willId: string }) {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [review, setReview] = useState('')
  const [error, setError] = useState('')

  const run = async () => {
    setLoading(true)
    setError('')
    const result = await reviewCaseWithAi({
      willId,
      estateSnapshot: toAiSnapshot(data),
      legalFlags: computeLegalFlags(data),
      completenessIssues: detectEstateIssues(data),
      question: question.trim() || undefined,
    })
    setLoading(false)
    if (result.ok) setReview(result.review ?? '')
    else setError(result.error || 'Could not run the review')
  }

  return (
    <PortalCard title="AI review (decision support only)">
      <p className="mb-2 text-xs text-slate-500">Synthesises the flags already shown above, plus staff notes. It never approves, changes, reassigns, or sends anything itself.</p>
      <textarea
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="Optional: ask something specific…"
        rows={2}
        className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10"
      />
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="flex items-center gap-2 rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        Run review
      </button>
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      {review && <p className="mt-3 text-sm whitespace-pre-wrap text-slate-700">{review}</p>}
    </PortalCard>
  )
}
