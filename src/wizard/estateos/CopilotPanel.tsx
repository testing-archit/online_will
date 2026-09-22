import { Bot, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { listAssets } from '../../lib/assetMapping'
import { answerEstateQuestionFromApi } from '../../lib/backendClient'
import { answerEstateQuestion, simulateScenario } from '../../lib/estateOs'
import { formatInr } from '../../lib/money'
import { newId } from '../../lib/id'
import type { WillData } from '../../lib/types'
import { InlineAction, History, OsPanel } from './OsUi'

const COPILOT_SUGGESTIONS = ['What assets have I assigned to my daughter?', 'What happens if my primary executor cannot act?', 'What is still missing?']
const SCENARIO_SUGGESTIONS = ['What happens if my wife dies before me?', 'What if my primary executor cannot act?', 'What if my son predeceases me?']

export function CopilotPanel() {
  const { watch, setValue, getValues } = useFormContext<WillData>()
  const data = watch()
  const [question, setQuestion] = useState('')
  const [scenario, setScenario] = useState('')
  const [asking, setAsking] = useState(false)

  async function ask(text = question) {
    const q = text.trim()
    if (!q) return
    setAsking(true)
    try {
      // Grounded answer first (built only from recorded data); the AI rewords it when available.
      const aiAnswer = await answerEstateQuestionFromApi(q, getValues())
      const answer = aiAnswer ?? answerEstateQuestion(getValues(), q)
      setValue(
        'estateOs.copilotHistory',
        [{ id: newId(), question: q, answer, source: aiAnswer ? ('ai' as const) : ('recorded' as const), createdAt: new Date().toISOString() }, ...getValues().estateOs.copilotHistory].slice(0, 30),
        { shouldDirty: true },
      )
      setQuestion('')
    } finally {
      setAsking(false)
    }
  }

  function run(text = scenario) {
    const s = text.trim()
    if (!s) return
    setValue(
      'estateOs.scenarioHistory',
      [{ id: newId(), scenario: s, outcome: simulateScenario(getValues(), s), createdAt: new Date().toISOString() }, ...getValues().estateOs.scenarioHistory].slice(0, 30),
      { shouldDirty: true },
    )
    setScenario('')
  }

  return (
    <>
      <OsPanel icon={Bot} title="Estate Copilot">
        <p className="mb-2 text-xs text-slate-500">Answers come from your recorded estate data only — if something is not recorded, it says so.</p>
        <InlineAction label="Ask the copilot" value={question} onChange={setQuestion} onClick={() => void ask()} busy={asking} placeholder="Ask: What assets have I assigned to my daughter?" button="Ask" />
        <Suggestions items={COPILOT_SUGGESTIONS} onPick={(text) => void ask(text)} />
        <History
          rows={data.estateOs.copilotHistory.map((item) => ({
            key: item.id,
            title: item.question,
            body: item.answer,
            badge: item.source === 'ai' ? 'AI · recorded data' : 'recorded data',
          }))}
          empty="Copilot answers will appear here."
        />
      </OsPanel>

      <OsPanel icon={SlidersHorizontal} title="What-if scenarios">
        <InlineAction label="Run a scenario" value={scenario} onChange={setScenario} onClick={() => run()} placeholder="Try: What if my primary executor cannot act?" button="Simulate" />
        <Suggestions items={SCENARIO_SUGGESTIONS} onPick={run} />
        <History rows={data.estateOs.scenarioHistory.map((item) => ({ key: item.id, title: item.scenario, body: item.outcome }))} empty="Scenario results will appear here." />
      </OsPanel>

      <DistributionSimulator />
    </>
  )
}

function Suggestions({ items, onPick }: { items: string[]; onPick: (text: string) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <button key={item} type="button" onClick={() => onPick(item)} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:border-brand-secondary hover:text-brand-secondary-ink">
          {item}
        </button>
      ))}
    </div>
  )
}

const BAR_COLORS = ['bg-brand-primary', 'bg-brand-secondary', 'bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-rose-400', 'bg-amber-500']

function DistributionSimulator() {
  const { watch, setValue, getValues } = useFormContext<WillData>()
  const data = watch()
  const [mode, setMode] = useState<'percentage' | 'assets'>('percentage')
  const [applied, setApplied] = useState('')

  const beneficiaries = data.distribution.beneficiaries.filter((beneficiary) => beneficiary.name.trim())
  const assets = listAssets(data).filter((asset) => asset.kind !== 'insurance')
  const estateValue = assets.reduce((sum, asset) => sum + (asset.value ?? 0), 0)

  const shares = beneficiaries.map((beneficiary) => ({ beneficiary, value: data.estateOs.distributionSimulation[beneficiary.id] ?? 0 }))
  const total = shares.reduce((sum, item) => sum + item.value, 0)

  function setShare(id: string, value: number) {
    setValue('estateOs.distributionSimulation', { ...getValues().estateOs.distributionSimulation, [id]: value }, { shouldDirty: true })
  }
  function splitEvenly() {
    const each = Math.floor(100 / Math.max(beneficiaries.length, 1))
    const next = Object.fromEntries(beneficiaries.map((beneficiary, index) => [beneficiary.id, index === 0 ? 100 - each * (beneficiaries.length - 1) : each]))
    setValue('estateOs.distributionSimulation', next, { shouldDirty: true })
  }

  // Asset mode: what each person would receive if every asset went to the chosen recipient.
  const assignment = data.estateOs.assetSimulation
  const perPerson = beneficiaries.map((beneficiary) => {
    const mine = assets.filter((asset) => assignment[asset.id] === beneficiary.id)
    return { beneficiary, assets: mine, value: mine.reduce((sum, asset) => sum + (asset.value ?? 0), 0) }
  })
  const unassigned = assets.filter((asset) => !beneficiaries.some((beneficiary) => beneficiary.id === assignment[asset.id]))

  function applyPercentages() {
    if (!window.confirm('Replace the shares in your Distribution step with these percentages?')) return
    const current = getValues().distribution
    setValue(
      'distribution',
      {
        ...current,
        scheme: 'percentage',
        beneficiaries: current.beneficiaries.map((beneficiary) => (beneficiary.id in data.estateOs.distributionSimulation ? { ...beneficiary, share: `${data.estateOs.distributionSimulation[beneficiary.id]}%` } : beneficiary)),
      },
      { shouldDirty: true },
    )
    setApplied('Percentages copied to your Distribution step.')
  }
  function applyAssets() {
    if (!window.confirm('Replace the asset assignments in your Distribution step with this simulation?')) return
    const current = getValues().distribution
    setValue(
      'distribution',
      {
        ...current,
        scheme: 'itemized',
        beneficiaries: current.beneficiaries.map((beneficiary) => ({ ...beneficiary, assignedAssetIds: assets.filter((asset) => assignment[asset.id] === beneficiary.id).map((asset) => asset.id) })),
      },
      { shouldDirty: true },
    )
    setApplied('Asset assignments copied to your Distribution step.')
  }

  return (
    <OsPanel icon={SlidersHorizontal} title="Distribution simulator">
      {beneficiaries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400">Add beneficiaries in the Distribution step to experiment with allocations.</p>
      ) : (
        <>
          <div className="mb-3 inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            {(['percentage', 'assets'] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={mode === key}
                onClick={() => {
                  setMode(key)
                  setApplied('')
                }}
                className={`rounded-full px-3 py-1 ${mode === key ? 'bg-brand-primary text-white' : 'text-slate-600'}`}
              >
                {key === 'percentage' ? 'By percentage' : 'By asset'}
              </button>
            ))}
          </div>

          {mode === 'percentage' ? (
            <div className="space-y-3">
              {shares.map(({ beneficiary, value }) => (
                <label key={beneficiary.id} className="grid items-center gap-2 sm:grid-cols-[160px_1fr_54px]">
                  <span className="text-sm font-medium text-slate-700">{beneficiary.name}</span>
                  <input type="range" min={0} max={100} value={value} onChange={(event) => setShare(beneficiary.id, Number(event.target.value))} aria-label={`${beneficiary.name} share`} />
                  <span className="text-right text-sm font-semibold text-slate-500">{value}%</span>
                </label>
              ))}
              <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Allocation chart">
                {shares.map(({ beneficiary, value }, index) => (
                  <div key={beneficiary.id} className={BAR_COLORS[index % BAR_COLORS.length]} style={{ width: `${Math.min(value, 100)}%` }} title={`${beneficiary.name} ${value}%`} />
                ))}
              </div>
              <div className={`rounded-xl border px-3 py-2 text-sm ${total === 100 ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                Total {total}%{total === 100 ? ' — fully allocated.' : total > 100 ? ` — ${total - 100}% over-allocated.` : ` — ${100 - total}% unallocated.`}
                {estateValue > 0 && (
                  <span className="mt-1 block text-xs">
                    On your recorded estate value of {formatInr(estateValue)}: {shares.filter((item) => item.value > 0).map(({ beneficiary, value }) => `${beneficiary.name} ${formatInr(Math.round((estateValue * value) / 100))}`).join(' · ') || '—'}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={splitEvenly} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">Split evenly</button>
                <button type="button" onClick={applyPercentages} disabled={total !== 100} className="rounded-full bg-brand-primary px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">Use in my Will</button>
              </div>
            </div>
          ) : assets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400">Add assets in the Assets step to assign them here.</p>
          ) : (
            <div className="space-y-3">
              {assets.map((asset) => (
                <label key={asset.id} className="grid items-center gap-2 sm:grid-cols-[1fr_200px]">
                  <span className="text-sm font-medium text-slate-700">
                    {asset.title} <span className="text-xs font-normal text-slate-400">{asset.value !== null ? formatInr(asset.value) : 'value not recorded'}</span>
                  </span>
                  <select
                    value={assignment[asset.id] ?? ''}
                    onChange={(event) => setValue('estateOs.assetSimulation', { ...getValues().estateOs.assetSimulation, [asset.id]: event.target.value }, { shouldDirty: true })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">— unassigned —</option>
                    {beneficiaries.map((beneficiary) => (
                      <option key={beneficiary.id} value={beneficiary.id}>{beneficiary.name}</option>
                    ))}
                  </select>
                </label>
              ))}
              <div className="grid gap-2 sm:grid-cols-2">
                {perPerson.map(({ beneficiary, assets: mine, value }) => (
                  <div key={beneficiary.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-sm font-semibold text-slate-800">{beneficiary.name}{value > 0 ? ` · ${formatInr(value)}` : ''}</p>
                    <p className="text-xs text-slate-500">{mine.length ? mine.map((asset) => asset.title).join(', ') : 'Nothing assigned'}</p>
                  </div>
                ))}
              </div>
              {unassigned.length > 0 && <p className="text-xs text-amber-700">{unassigned.length} asset(s) unassigned: {unassigned.map((asset) => asset.title).join(', ')}</p>}
              <button type="button" onClick={applyAssets} className="rounded-full bg-brand-primary px-3 py-1 text-xs font-semibold text-white">Use in my Will</button>
            </div>
          )}
          {applied && <p className="mt-2 text-xs text-emerald-700" role="status">{applied}</p>}
        </>
      )}
    </OsPanel>
  )
}
