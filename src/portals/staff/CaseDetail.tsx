'use client'

import { ArrowLeft, Download, Loader2, Send } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { fetchWill, listComments, postComment, setCommentStatus, type ServerComment } from '../../lib/backendClient'
import { buildEstateProfile, type EstateProfile } from '../../lib/estateProfile'
import type { EstateReportType } from '../../pdf/EstateReportDocument'
import type { WillData } from '../../lib/types'
import { CompletionPill, ItemList, PortalCard } from '../shared'

const REPORT_BUTTON_LABEL: Record<EstateReportType, string> = {
  client: 'Download Client Report',
  advisor: 'Download Advisor Report',
  lawyer: 'Download Lawyer Brief',
  admin: 'Download Admin Report',
}

/** One case-detail page, shared by every staff portal -- only the report type, "back to list" link, and an
 * optional extra sidebar panel (the admin portal's reassignment + AI review) differ. */
export function CaseDetail({ backPath, reportType, extraPanel }: { backPath: string; reportType: EstateReportType; extraPanel?: (data: WillData, willId: string) => ReactNode }) {
  const params = useParams<{ willId: string }>()
  const willId = params.willId ?? ''
  const [loaded, setLoaded] = useState<{ willId: string; data: WillData | 'error' }>()
  const data = loaded?.willId === willId ? loaded.data : 'loading'
  const [comments, setComments] = useState<ServerComment[]>([])
  const [message, setMessage] = useState('')
  const [posting, setPosting] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([fetchWill(willId), listComments(willId)]).then(([will, threads]) => {
      if (cancelled) return
      setLoaded({ willId, data: will ?? 'error' })
      setComments(threads ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [willId])

  if (data === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading case…
      </div>
    )
  }
  if (data === 'error') {
    return <p className="text-sm text-rose-600">Could not load this case. You may not have access to it.</p>
  }

  const profile: EstateProfile = buildEstateProfile(data)

  const refreshComments = async () => setComments((await listComments(willId)) ?? [])

  const submitComment = async (event: FormEvent) => {
    event.preventDefault()
    if (!message.trim()) return
    setPosting(true)
    await postComment(willId, message.trim())
    setMessage('')
    await refreshComments()
    setPosting(false)
  }

  const toggleResolved = async (comment: ServerComment) => {
    await setCommentStatus(comment.id, comment.status === 'open' ? 'resolved' : 'open')
    await refreshComments()
  }

  return (
    <div>
      <Link href={backPath} className="mb-4 flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" /> All cases
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl text-slate-900">{profile.clientName}</h1>
          <div className="mt-1.5">
            <CompletionPill value={profile.completion.overall} />
          </div>
        </div>
        <button
          type="button"
          disabled={downloading}
          onClick={async () => {
            setDownloading(true)
            const { downloadEstateReportPdf } = await import('../../pdf/generatePdf')
            await downloadEstateReportPdf(data, reportType)
            setDownloading(false)
          }}
          className="flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-primary-hover active:translate-y-px disabled:opacity-60"
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {REPORT_BUTTON_LABEL[reportType]}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          {profile.missingInformation.length > 0 && (
            <PortalCard title="Flagged for review">
              <ItemList items={profile.missingInformation} />
            </PortalCard>
          )}
          <PortalCard title="Family">
            <ItemList items={profile.familyMembers} />
          </PortalCard>
          <PortalCard title="Executors">
            <ItemList items={profile.executors} />
          </PortalCard>
          {profile.guardians.length > 0 && (
            <PortalCard title="Guardians">
              <ItemList items={profile.guardians} />
            </PortalCard>
          )}
          <PortalCard title="Beneficiaries & distribution">
            <ItemList items={profile.distributionInstructions} empty="No distribution instructions recorded yet" />
          </PortalCard>
          <PortalCard title="Assets">
            <ItemList items={profile.assets} />
          </PortalCard>
          {profile.liabilities.length > 0 && (
            <PortalCard title="Liabilities">
              <ItemList items={profile.liabilities} />
            </PortalCard>
          )}
          {profile.insurance.length > 0 && (
            <PortalCard title="Insurance">
              <ItemList items={profile.insurance} />
            </PortalCard>
          )}
          <PortalCard title="Execution status">
            <ItemList items={profile.executionStatus} />
          </PortalCard>
        </div>

        <div className="flex flex-col gap-4">
          {extraPanel?.(data, willId)}
          <PortalCard title="Notes to the client">
            <div className="flex max-h-96 flex-col gap-2.5 overflow-y-auto">
              {comments.length === 0 && <p className="text-sm text-slate-400">No notes yet.</p>}
              {comments.map((comment) => (
                <div key={comment.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-600 capitalize">{comment.senderRole}</span>
                    <button type="button" onClick={() => toggleResolved(comment)} className="text-xs font-medium text-brand-primary hover:underline">
                      {comment.status === 'open' ? 'Mark resolved' : 'Reopen'}
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-slate-800">{comment.message}</p>
                  <p className="mt-1 text-xs text-slate-400">{new Date(comment.createdAt).toLocaleString('en-IN')}</p>
                </div>
              ))}
            </div>
            <form onSubmit={submitComment} className="mt-3 flex gap-2">
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Add a note or question…"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10"
              />
              <button type="submit" disabled={posting || !message.trim()} className="flex items-center justify-center rounded-lg bg-brand-primary px-3 text-white disabled:opacity-50">
                {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </form>
          </PortalCard>
        </div>
      </div>
    </div>
  )
}
