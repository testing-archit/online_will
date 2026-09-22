import { MessageSquare, Plus } from 'lucide-react'
import { useFormContext } from 'react-hook-form'
import { generateFollowUpQuestions } from '../../lib/estateOs'
import type { WillData } from '../../lib/types'
import { InterviewComposer, ProposalList } from '../interview/InterviewComposer'
import { useInterview } from '../interview/useInterview'
import { OsPanel } from './OsUi'

export function InterviewPanel() {
  const { watch, setValue, getValues } = useFormContext<WillData>()
  const data = watch()
  const { isThinking, pendingProposals, confirmedProposals, send, confirm, dismiss } = useInterview()

  function refreshFollowUps() {
    setValue('estateOs.generatedFollowUps', generateFollowUpQuestions(getValues()), { shouldDirty: true })
  }
  function setFollowUpStatus(id: string, status: 'open' | 'answered' | 'dismissed') {
    setValue(
      'estateOs.generatedFollowUps',
      getValues().estateOs.generatedFollowUps.map((item) => (item.id === id ? { ...item, status } : item)),
      { shouldDirty: true },
    )
  }

  const followUps = data.estateOs.generatedFollowUps
  const spoken = data.estateOs.voiceInterviewNotes
  const multilingual = data.estateOs.hinglishInterviewNotes

  return (
    <OsPanel icon={MessageSquare} title="Follow-up questions, voice, and Hindi / Hinglish interview">
      <p className="mb-2 text-xs text-slate-500">
        Follow-ups are chosen from approved question templates and the gaps found in your recorded answers — they are never free-form model output.
      </p>
      <button type="button" onClick={refreshFollowUps} className="inline-flex items-center gap-2 rounded-full bg-brand-primary px-4 py-2 text-sm font-semibold text-white">
        <Plus className="h-4 w-4" /> Generate follow-up questions
      </button>
      <ul className="mt-3 space-y-2">
        {followUps.map((item) => (
          <li key={item.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${item.status === 'open' ? 'border-slate-100 bg-slate-50 text-slate-700' : 'border-slate-100 bg-white text-slate-400 line-through'}`}>
            <span>{item.question}</span>
            <span className="flex gap-1.5 no-underline">
              {item.status === 'open' ? (
                <>
                  <button type="button" onClick={() => setFollowUpStatus(item.id, 'answered')} className="rounded-full border border-emerald-200 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">Answered</button>
                  <button type="button" onClick={() => setFollowUpStatus(item.id, 'dismissed')} className="rounded-full border border-slate-200 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500">Dismiss</button>
                </>
              ) : (
                <button type="button" onClick={() => setFollowUpStatus(item.id, 'open')} className="rounded-full border border-slate-200 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500">Reopen</button>
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 p-3">
        <h4 className="text-sm font-semibold text-slate-800">Speak or write in your own language</h4>
        <p className="mb-3 mt-1 text-xs text-slate-500">
          Dictate, record or type in English, Hindi or Hinglish. Samaira turns it into structured English data and shows it below for you to confirm — nothing is
          added to your Will automatically.
        </p>
        <InterviewComposer onSend={send} isThinking={isThinking} rows={3} />
        <div className="mt-4 space-y-4">
          <ProposalList pending={pendingProposals} confirmed={confirmedProposals} onConfirm={confirm} onDismiss={dismiss} />
        </div>
        {(spoken.length > 0 || multilingual.length > 0) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <StatementLog title="Spoken statements" items={spoken} />
            <StatementLog title="Hindi / Hinglish statements" items={multilingual} />
          </div>
        )}
      </div>
    </OsPanel>
  )
}

function StatementLog({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title} (original wording kept)</p>
      <ul className="mt-1 space-y-1">
        {items.length === 0 && <li className="text-xs text-slate-400">None yet</li>}
        {items.slice(0, 4).map((item, index) => (
          <li key={`${index}-${item.slice(0, 24)}`} className="rounded-lg bg-white px-2 py-1 text-xs text-slate-600">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
