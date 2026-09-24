'use client'

import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchAuditLog, type AuditLogEntry } from '../../lib/backendClient'

function describeEntry(entry: AuditLogEntry): string {
  if (entry.action === 'create' || entry.action === 'update' || entry.action === 'delete') {
    return `${entry.action} ${entry.collection ?? 'record'}${entry.version ? ` (v${entry.version})` : ''}`
  }
  return entry.summary || entry.action || 'Activity'
}

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[] | 'loading' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    void fetchAuditLog().then((result) => {
      if (!cancelled) setEntries(result ?? 'error')
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div>
      <h1 className="font-display text-xl text-slate-900">Audit log</h1>
      <p className="mt-1 text-sm text-slate-500">The most recent recorded activity across the platform, newest first.</p>

      {entries === 'loading' && (
        <div className="mt-8 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}
      {entries === 'error' && <p className="mt-8 text-sm text-rose-600">Could not load the audit log.</p>}
      {Array.isArray(entries) && (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-5 py-3">When</th>
                <th className="px-5 py-3">Actor</th>
                <th className="px-5 py-3">Activity</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3 whitespace-nowrap text-slate-500">{new Date(entry.createdAt).toLocaleString('en-IN')}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {entry.actorRole || 'unknown'} {entry.actorId && <span className="text-slate-400">({entry.actorId.slice(0, 12)})</span>}
                  </td>
                  <td className="px-5 py-3 text-slate-800">{describeEntry(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
