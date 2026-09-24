'use client'

import { Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { CaseSummary } from '../../lib/backendClient'

/** One case-list page, shared by every staff portal -- only the data source, title and subtitle differ.
 * `basePath` (e.g. "/lawyer") makes the per-case links absolute -- Next's Link, unlike react-router's, resolves
 * a relative href against the current URL the way a plain <a> would, not against the matched route segment. */
export function CaseList({
  fetchCases,
  basePath,
  title = 'Assigned cases',
  subtitle,
}: {
  fetchCases: () => Promise<CaseSummary[] | null>
  basePath: string
  title?: string
  subtitle: string
}) {
  const [cases, setCases] = useState<CaseSummary[] | 'loading' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    void fetchCases().then((result) => {
      if (!cancelled) setCases(result ?? 'error')
    })
    return () => {
      cancelled = true
    }
  }, [fetchCases])

  return (
    <div>
      <h1 className="font-display text-xl text-slate-900">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>

      {cases === 'loading' && (
        <div className="mt-8 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading cases…
        </div>
      )}
      {cases === 'error' && <p className="mt-8 text-sm text-rose-600">Could not load your cases. Try refreshing.</p>}
      {Array.isArray(cases) && cases.length === 0 && <p className="mt-8 text-sm text-slate-500">No cases are assigned to you yet.</p>}

      {Array.isArray(cases) && cases.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-5 py-3">Client</th>
                <th className="px-5 py-3">State</th>
                <th className="px-5 py-3">Version</th>
                <th className="px-5 py-3">Updated</th>
                <th className="px-5 py-3">Open threads</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((item) => (
                <tr key={item.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3">
                    <Link href={`${basePath}/cases/${item.id}`} className="font-medium text-brand-primary hover:underline">
                      {item.clientName}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{item.state || '—'}</td>
                  <td className="px-5 py-3 text-slate-600">v{item.version}</td>
                  <td className="px-5 py-3 text-slate-600">{new Date(item.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td className="px-5 py-3">
                    {item.openThreads > 0 ? (
                      <span className="rounded-full bg-brand-secondary/10 px-2 py-0.5 text-xs font-semibold text-brand-secondary-ink">{item.openThreads} open</span>
                    ) : (
                      <span className="text-xs text-slate-400">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
