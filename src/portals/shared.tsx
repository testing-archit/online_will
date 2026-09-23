import type { ReactNode } from 'react'
import type { EstateProfileItem } from '../lib/estateProfile'

export function PortalCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card-shadow rounded-2xl border border-slate-200/80 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function ItemList({ items, empty = 'None recorded' }: { items: EstateProfileItem[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-slate-400">{empty}</p>
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id} className="rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5">
          <p className="text-sm font-medium text-slate-800">{item.title}</p>
          {item.subtitle && <p className="text-xs text-slate-500">{item.subtitle}</p>}
          {item.meta && <p className="mt-0.5 text-xs text-slate-400">{item.meta}</p>}
        </li>
      ))}
    </ul>
  )
}

export function CompletionPill({ value }: { value: number }) {
  const tone = value >= 90 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : value >= 50 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-rose-50 text-rose-700 border-rose-200'
  return <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}>{value}% complete</span>
}
