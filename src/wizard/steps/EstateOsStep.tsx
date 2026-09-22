import { History as HistoryIcon } from 'lucide-react'
import { useFormContext } from 'react-hook-form'
import type { WillData } from '../../lib/types'
import { CollaborationPanel } from '../estateos/CollaborationPanel'
import { CopilotPanel } from '../estateos/CopilotPanel'
import { ExecutionPanel } from '../estateos/ExecutionPanel'
import { InterviewPanel } from '../estateos/InterviewPanel'
import { LegacyPanel } from '../estateos/LegacyPanel'
import { OsPanel } from '../estateos/OsUi'

export function EstateOsStep() {
  return (
    <div className="space-y-6">
      <CopilotPanel />
      <InterviewPanel />
      <CollaborationPanel />
      <ExecutionPanel />
      <AuditTrailPanel />
      <LegacyPanel />
    </div>
  )
}

function AuditTrailPanel() {
  const { watch } = useFormContext<WillData>()
  const trail = watch('estateOs.auditTrail')

  return (
    <OsPanel icon={HistoryIcon} title="Compliance & audit trail">
      <p className="mb-3 text-xs text-slate-500">
        Every important change is recorded — who, what, when, and before/after. The server keeps a separate append-only log of every save, upload and access.
      </p>
      {trail.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400">Audit events will appear here as the Will is saved and reviewed.</p>
      ) : (
        <div className="space-y-2">
          {trail.slice(0, 10).map((entry) => (
            <div key={entry.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-sm font-semibold text-slate-800">
                {entry.summary}
                <span className="ml-2 text-[11px] font-medium text-slate-400">
                  {entry.actorRole} · {new Date(entry.createdAt).toLocaleString()}
                </span>
              </p>
              {(entry.before || entry.after) && (
                <div className="mt-1 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                  {entry.before && <p className="break-words rounded bg-white px-2 py-1">Before: {entry.before}</p>}
                  {entry.after && <p className="break-words rounded bg-white px-2 py-1">After: {entry.after}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </OsPanel>
  )
}
