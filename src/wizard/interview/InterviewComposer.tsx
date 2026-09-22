import { Check, Send, X } from 'lucide-react'
import { useState } from 'react'
import { fieldChangeRows } from '../../lib/fieldProposals'
import type { InterviewBeneficiaryProposal, InterviewTurnProposal, WillData } from '../../lib/types'
import { Card, SelectInput, TextArea } from '../fields'
import { DICTATION_LOCALE, LANGUAGE_LABEL, type InterviewSource, type LanguageChoice, type SendResult } from './useInterview'
import { VoiceControls } from './VoiceControls'

const PLACEHOLDER: Record<LanguageChoice, string> = {
  auto: 'Type or speak in English, Hindi or Hinglish — e.g. Meri beti ko Noida wala ghar dena hai.',
  en: 'e.g. Mostly my wife, but I want my daughter to get the property in Noida.',
  hi: 'जैसे: मेरी पत्नी को ज़्यादातर, लेकिन नोएडा का मकान बेटी को दें।',
  hinglish: 'e.g. Aapke paas koi property hai jo aap kisi ko specifically dena chahte hain? — Meri beti ko Noida wala ghar dena hai.',
}

export function InterviewComposer({
  onSend,
  isThinking,
  defaultLanguage = 'auto',
  defaultSource = 'typed',
  rows = 3,
  showLanguage = true,
  language: controlledLanguage,
  onLanguageChange,
}: {
  language?: LanguageChoice
  onLanguageChange?: (language: LanguageChoice) => void
  onSend: (text: string, options: { language: LanguageChoice; source: InterviewSource }) => Promise<SendResult | null>
  isThinking: boolean
  defaultLanguage?: LanguageChoice
  defaultSource?: InterviewSource
  rows?: number
  /** Hide the language picker when it is already shown elsewhere (the assistant panel keeps it beside the voice controls). */
  showLanguage?: boolean
}) {
  const [text, setText] = useState('')
  const [ownLanguage, setOwnLanguage] = useState<LanguageChoice>(defaultLanguage)
  const language = controlledLanguage ?? ownLanguage
  const setLanguage = onLanguageChange ?? setOwnLanguage
  // Once text arrives by voice, keep recording that it was spoken even if the user tidies it before sending.
  const [spoken, setSpoken] = useState(defaultSource === 'voice')

  async function submit() {
    if (!text.trim() || isThinking) return
    const sent = await onSend(text, { language, source: spoken ? 'voice' : 'typed' })
    if (sent) {
      setText('')
      setSpoken(defaultSource === 'voice')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className={`items-center gap-2 text-xs font-medium text-slate-600 ${showLanguage ? 'flex' : 'hidden'}`}>
          Language
          <div className="w-44">
            <SelectInput value={language} onChange={(event) => setLanguage(event.target.value as LanguageChoice)} aria-label="Interview language">
              {(Object.keys(LANGUAGE_LABEL) as LanguageChoice[]).map((key) => (
                <option key={key} value={key}>
                  {LANGUAGE_LABEL[key]}
                </option>
              ))}
            </SelectInput>
          </div>
        </label>
        <VoiceControls
          value={text}
          onChange={(next) => {
            setSpoken(true)
            setText(next)
          }}
          locale={DICTATION_LOCALE[language]}
          languageHint={language === 'en' ? 'en-IN' : language === 'hi' ? 'hi-IN' : language === 'hinglish' ? 'Hinglish (Hindi + English mix)' : 'auto'}
        />
      </div>
      <TextArea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={rows}
        placeholder={PLACEHOLDER[language]}
        lang={language === 'hi' ? 'hi' : 'en'}
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!text.trim() || isThinking}
        className="inline-flex items-center gap-2 rounded-full bg-brand-primary px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Send className="h-4 w-4" />
        {isThinking ? 'Sending...' : 'Send to Samaira'}
      </button>
    </div>
  )
}

export function ProposalList({
  pending,
  confirmed,
  onConfirm,
  onDismiss,
  currentData,
}: {
  pending: InterviewTurnProposal[]
  confirmed: InterviewTurnProposal[]
  onConfirm: (proposal: InterviewTurnProposal) => void
  onDismiss: (id: string) => void
  /** The form as it is now, so a suggested answer can show what it would replace. */
  currentData?: WillData
}) {
  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-800">Waiting for your confirmation</h3>
          {pending.length > 1 && (
            <button
              type="button"
              onClick={() => pending.forEach((proposal) => onConfirm(proposal))}
              className="inline-flex items-center gap-1 rounded-full bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white"
            >
              <Check className="h-3.5 w-3.5" /> Confirm all ({pending.length})
            </button>
          )}
        </div>
        {pending.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400">
            Anything Samaira suggests appears here first. Nothing is added to your Will until you confirm it.
          </p>
        )}
        {pending.map((proposal) => (
          <Card key={proposal.id}>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Original statement</p>
                <p className="mt-1 text-sm text-slate-700">{proposal.originalStatement}</p>
              </div>
              {proposal.beneficiaries.length > 0 && (
                <div className="grid gap-2">
                  {proposal.beneficiaries.map((beneficiary) => (
                    <BeneficiaryProposalCard key={beneficiary.id} beneficiary={beneficiary} />
                  ))}
                </div>
              )}
              {(proposal.fieldUpdates?.length ?? 0) > 0 && <FieldChanges updates={proposal.fieldUpdates ?? []} currentData={currentData} />}
              <p className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900">{proposal.followUpQuestion}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onConfirm(proposal)}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white"
                >
                  <Check className="h-3.5 w-3.5" /> {proposal.beneficiaries.length > 0 ? 'Confirm and add to Will' : 'Confirm and fill in'}
                </button>
                <button
                  type="button"
                  onClick={() => onDismiss(proposal.id)}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500"
                >
                  <X className="h-3.5 w-3.5" /> Dismiss
                </button>
              </div>
            </div>
          </Card>
        ))}
      </section>

      {confirmed.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">Confirmed Samaira interpretations</h3>
          {confirmed.map((proposal) => (
            <p key={proposal.id} className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <span className="block text-xs text-emerald-700">“{proposal.originalStatement}”</span>
              {[
                ...proposal.beneficiaries.map((beneficiary) => [beneficiary.name, beneficiary.share, beneficiary.specificBequest].filter(Boolean).join(' · ')),
                ...fieldChangeRows(undefined, proposal.fieldUpdates ?? []).map((row) => `${row.label}: ${row.after}`),
              ].join('; ')}
            </p>
          ))}
        </section>
      )}
    </>
  )
}

function FieldChanges({ updates, currentData }: { updates: NonNullable<InterviewTurnProposal['fieldUpdates']>; currentData?: WillData }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50" aria-label="Suggested answers">
      {fieldChangeRows(currentData, updates).map((row) => (
        <li key={row.path} className="px-3 py-2">
          <p className="text-xs font-medium text-slate-500">{row.label}</p>
          <p className="mt-0.5 text-sm text-slate-800">
            {row.before && <span className="mr-1.5 text-slate-400 line-through">{row.before}</span>}
            <span className="font-medium">{row.after}</span>
          </p>
        </li>
      ))}
    </ul>
  )
}

function BeneficiaryProposalCard({ beneficiary }: { beneficiary: InterviewBeneficiaryProposal }) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <ProposalField label="Beneficiary" value={beneficiary.name} />
      <ProposalField label="Type" value={beneficiary.relationship || 'Unknown'} />
      <ProposalField label="Share" value={beneficiary.share || 'Not specified'} />
      <ProposalField label="Specific bequest" value={beneficiary.specificBequest || 'None'} />
    </div>
  )
}

function ProposalField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-800">{value}</p>
    </div>
  )
}
