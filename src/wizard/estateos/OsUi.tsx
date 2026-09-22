import type { Bot } from 'lucide-react'
import type { ReactNode } from 'react'
import { TextInput } from '../fields'

export function OsPanel({ icon: Icon, title, children }: { icon: typeof Bot; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-brand-primary" />
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>
      {children}
    </section>
  )
}

export function InlineAction({
  value,
  onChange,
  onClick,
  placeholder,
  button,
  busy = false,
  compact = false,
  label,
}: {
  value: string
  onChange: (value: string) => void
  onClick: () => void
  placeholder: string
  button: string
  busy?: boolean
  compact?: boolean
  label: string
}) {
  return (
    <div className={`grid gap-2 ${compact ? 'sm:grid-cols-[260px_auto]' : 'sm:grid-cols-[1fr_auto]'}`}>
      <TextInput
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (value.trim() && !busy) onClick()
          }
        }}
        placeholder={placeholder}
        aria-label={label}
      />
      <button
        type="button"
        onClick={onClick}
        disabled={busy || !value.trim()}
        className="rounded-xl bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? 'Working…' : button}
      </button>
    </div>
  )
}

export function History({ rows, empty, limit = 4 }: { rows: { key: string; title: string; body: string; badge?: string }[]; empty: string; limit?: number }) {
  if (rows.length === 0) return <p className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400">{empty}</p>
  return (
    <div className="mt-3 space-y-2">
      {rows.slice(0, limit).map((row) => (
        <div key={row.key} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="flex items-start justify-between gap-2 text-sm font-semibold text-slate-800">
            <span>{row.title}</span>
            {row.badge && <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-400">{row.badge}</span>}
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{row.body}</p>
        </div>
      ))}
    </div>
  )
}
