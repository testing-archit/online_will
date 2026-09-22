import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, FileText, GitBranch, Scale, ShieldAlert, Sparkles, Users } from 'lucide-react'
import { useMemo } from 'react'
import { useFormContext } from 'react-hook-form'
import { buildNominationAlignment, mapAssetsToBeneficiaries, type AlignmentStatus, type MappingBasis } from '../../lib/assetMapping'
import { buildEstateProfile, buildFamilyGraph, type EstateProfileItem, type FamilyPerson } from '../../lib/estateProfile'
import { buildEstateSummary } from '../../lib/estateSummary'
import { buildGapAnalysis } from '../../lib/gapAnalysis'
import { formatInr } from '../../lib/money'
import type { WillData } from '../../lib/types'

const COMPLETION_LABELS = [
  ['family', 'Family Information'],
  ['assets', 'Asset Inventory'],
  ['beneficiaries', 'Beneficiaries'],
  ['nominations', 'Nominations'],
  ['documents', 'Documents'],
  ['executors', 'Executors'],
  ['contingencies', 'Contingencies'],
  ['execution', 'Execution'],
] as const

export function EstateProfileStep() {
  const { watch } = useFormContext<WillData>()
  const data = watch()
  const profile = useMemo(() => buildEstateProfile(data), [data])
  const gapAnalysis = useMemo(() => buildGapAnalysis(data), [data])
  const summary = useMemo(() => buildEstateSummary(data), [data])
  const graph = useMemo(() => buildFamilyGraph(data), [data])
  const mapping = useMemo(() => mapAssetsToBeneficiaries(data), [data])
  const alignment = useMemo(() => buildNominationAlignment(data), [data])

  return (
    <div className="space-y-7">
      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Estate readiness" value={`${profile.completion.overall}%`} detail="Workflow completion, not legal validity" />
        <SummaryCard label="Estimated value" value={summary.estimatedValue === null ? '—' : formatInr(summary.estimatedValue)} detail={summary.valueNote} />
        <SummaryCard label="Open items" value={String(profile.missingInformation.length)} detail={`${profile.assets.length} asset(s), ${profile.liabilities.length} liability item(s)`} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-secondary-ink" />
          <h3 className="text-sm font-semibold text-slate-900">Estate summary</h3>
        </div>
        <pre className="whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 p-4 font-sans text-sm leading-relaxed text-slate-700">{summary.text}</pre>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-4 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-brand-secondary-ink" />
          <h3 className="text-sm font-semibold text-slate-900">Estate Preparation</h3>
        </div>
        <div className="space-y-3">
          {COMPLETION_LABELS.map(([key, label]) => (
            <div key={key} className="grid items-center gap-2 sm:grid-cols-[170px_1fr_48px]">
              <span className="text-xs font-medium text-slate-600">{label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={profile.completion[key]} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
                <div className="h-full rounded-full bg-brand-secondary" style={{ width: `${profile.completion[key]}%` }} />
              </div>
              <span className="text-right text-xs font-semibold text-slate-500">{profile.completion[key]}%</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <FamilyTree graph={graph} />
        <ProfilePanel icon={Users} title="Family & roles" items={[...profile.executors, ...profile.guardians]} empty="No executors or guardians named yet." />
        <AssetBeneficiaryMap rows={mapping} />
        <ProfilePanel icon={FileText} title="Assets, liabilities & insurance" items={[...profile.assets, ...profile.liabilities, ...profile.insurance]} empty="No assets, liabilities, or policies recorded yet." />
        <NominationTable rows={alignment} />
        <ProfilePanel icon={GitBranch} title="Distribution instructions" items={profile.distributionInstructions} empty="No beneficiary mapping yet." />
        <ProfilePanel icon={AlertTriangle} title="Missing information" items={profile.missingInformation} empty="No mandatory gaps detected in visible questions." />
        <ProfilePanel icon={FileText} title="Documents" items={profile.documents} empty="No document checklist items yet." />
        <ProfilePanel icon={CircleDashed} title="Execution status" items={profile.executionStatus} empty="No execution information yet." />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-1 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-brand-primary" />
          <h3 className="text-sm font-semibold text-slate-900">Estate planning gaps</h3>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          These are planning gaps — workflow and completeness items worth closing — not legal-risk determinations. Your consulting lawyer defines legal risk.
        </p>
        {gapAnalysis.gaps.length === 0 ? (
          <p className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50 px-3 py-4 text-sm text-emerald-800">No planning gaps detected — the recorded estate information is in good shape.</p>
        ) : (
          <div className="space-y-2">
            {gapAnalysis.gaps.map((gap) => (
              <div key={gap.id} className={`rounded-xl border px-3 py-2 ${gap.severity === 'attention' ? 'border-amber-200 bg-amber-50' : 'border-sky-200 bg-sky-50'}`}>
                <p className={`text-sm font-semibold ${gap.severity === 'attention' ? 'text-amber-900' : 'text-sky-900'}`}>⚠ {gap.title}</p>
                <p className={`mt-0.5 text-xs ${gap.severity === 'attention' ? 'text-amber-800' : 'text-sky-800'}`}>{gap.detail}</p>
              </div>
            ))}
          </div>
        )}
        {gapAnalysis.strengths.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-500" />
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Already in good shape</h4>
            </div>
            <div className="space-y-2">
              {gapAnalysis.strengths.map((strength) => (
                <div key={strength.id} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <p className="text-sm font-semibold text-emerald-900">{strength.title}</p>
                  <p className="mt-0.5 text-xs text-emerald-800">{strength.detail}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-brand-primary" style={{ fontFamily: 'var(--font-display)' }}>
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  )
}

function ProfilePanel({ icon: Icon, title, items, empty }: { icon: typeof Users; title: string; items: EstateProfileItem[]; empty: string }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-brand-primary" />
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {items.length > 8 && <span className="ml-auto text-[11px] text-slate-400">showing 8 of {items.length}</span>}
      </div>
      {items.length ? (
        <div className="space-y-2">
          {items.slice(0, 8).map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-sm font-semibold text-slate-800">{item.title}</p>
              {item.subtitle && <p className="mt-0.5 text-xs text-slate-500">{item.subtitle}</p>}
              {item.meta && <p className="mt-1 text-[11px] font-medium text-slate-400">{item.meta}</p>}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400">{empty}</p>
      )}
    </section>
  )
}

function PersonNode({ person }: { person: FamilyPerson }) {
  return (
    <div className="min-w-[140px] flex-1 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-center">
      <p className="text-sm font-medium text-slate-800">{person.name}</p>
      <p className="text-xs text-slate-500">{[person.relationship, person.age && `age ${person.age}`].filter(Boolean).join(' · ')}</p>
      {person.roles.length > 0 && (
        <div className="mt-1 flex flex-wrap justify-center gap-1">
          {person.roles.map((role) => (
            <span key={role} className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-brand-primary">{role}</span>
          ))}
        </div>
      )}
      {person.assets.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Receives: {person.assets.join(', ')}</p>}
    </div>
  )
}

function FamilyTree({ graph }: { graph: ReturnType<typeof buildFamilyGraph> }) {
  const tiers: { label: string; people: FamilyPerson[] }[] = [
    { label: 'Spouse / partner', people: graph.spouse },
    { label: 'Children', people: graph.children },
    { label: 'Parents', people: graph.parents },
    { label: 'Others named in the Will', people: graph.others },
  ].filter((tier) => tier.people.length > 0)

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-brand-primary" />
        <h3 className="text-sm font-semibold text-slate-900">Family tree</h3>
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="rounded-xl border border-brand-primary/20 bg-brand-primary/5 px-4 py-2 text-center">
          <p className="text-sm font-semibold text-brand-primary">{graph.testator.name}</p>
          <p className="text-xs text-slate-500">Testator{graph.testator.age ? ` · age ${graph.testator.age}` : ''}</p>
        </div>
        {tiers.map((tier) => (
          <div key={tier.label} className="flex w-full flex-col items-center gap-2">
            <div className="h-4 w-px bg-slate-300" aria-hidden />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{tier.label}</p>
            <div className="flex w-full flex-wrap justify-center gap-2">
              {tier.people.map((person) => <PersonNode key={person.key} person={person} />)}
            </div>
          </div>
        ))}
        {tiers.length === 0 && <p className="text-sm text-slate-400">Beneficiaries, children and family roles will appear here.</p>}
      </div>
    </section>
  )
}

const BASIS_LABEL: Record<MappingBasis, string> = { assigned: 'assigned', described: 'as described', share: 'by share', residue: 'residue' }
const BASIS_STYLE: Record<MappingBasis, string> = {
  assigned: 'bg-brand-primary text-white',
  described: 'bg-brand-primary/10 text-brand-primary',
  share: 'bg-slate-100 text-slate-600',
  residue: 'bg-amber-100 text-amber-800',
}

function AssetBeneficiaryMap({ rows }: { rows: ReturnType<typeof mapAssetsToBeneficiaries> }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <ArrowRight className="h-4 w-4 text-brand-primary" />
        <h3 className="text-sm font-semibold text-slate-900">Asset to beneficiary map</h3>
      </div>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map(({ asset, targets }) => (
            <div key={asset.id} className="grid items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 sm:grid-cols-[1fr_auto_1fr]">
              <p className="text-sm font-medium text-slate-800">{asset.title}</p>
              <ArrowRight className="hidden h-4 w-4 text-slate-300 sm:block" />
              <div className="flex flex-wrap gap-1.5">
                {targets.length === 0 && <span className="text-sm text-amber-700">Recipient not recorded</span>}
                {targets.map((target) => (
                  <span key={`${target.beneficiaryId}-${target.basis}`} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BASIS_STYLE[target.basis]}`} title={target.detail}>
                    {target.name} · {BASIS_LABEL[target.basis]}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400">Add assets and beneficiaries to see the mapping.</p>
      )}
    </section>
  )
}

const ALIGNMENT_STYLE: Record<AlignmentStatus, { label: string; className: string }> = {
  aligned: { label: '✓ aligned', className: 'bg-emerald-100 text-emerald-800' },
  mismatch: { label: '⚠ differs', className: 'bg-amber-100 text-amber-800' },
  'no-nominee': { label: 'no nominee', className: 'bg-slate-100 text-slate-600' },
  'no-intended-beneficiary': { label: 'no intended beneficiary', className: 'bg-slate-100 text-slate-600' },
}

function NominationTable({ rows }: { rows: ReturnType<typeof buildNominationAlignment> }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <Scale className="h-4 w-4 text-brand-primary" />
        <h3 className="text-sm font-semibold text-slate-900">Nominee vs intended beneficiary</h3>
      </div>
      <p className="mb-3 text-xs text-slate-500">Differences are flagged for review; the legal consequence of a mismatch is for your lawyer to advise on.</p>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400">Add insurance, bank or investment assets with nominees to compare them.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-1 pr-2 font-semibold">Asset</th>
                <th className="py-1 pr-2 font-semibold">Nominee</th>
                <th className="py-1 pr-2 font-semibold">Intended</th>
                <th className="py-1 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.assetId} className="border-t border-slate-100 align-top">
                  <td className="py-1.5 pr-2 font-medium text-slate-800">{row.assetTitle}</td>
                  <td className="py-1.5 pr-2 text-slate-600">{row.nominee || '—'}</td>
                  <td className="py-1.5 pr-2 text-slate-600">{row.intendedBeneficiaries.join(', ') || '—'}</td>
                  <td className="py-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ALIGNMENT_STYLE[row.status].className}`}>{ALIGNMENT_STYLE[row.status].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
