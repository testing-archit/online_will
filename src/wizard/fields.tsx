import { motion } from 'framer-motion'
import { AlertCircle, AlertTriangle, ChevronDown, Info, Plus, Trash2 } from 'lucide-react'
import { useId, type ReactNode } from 'react'

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium tracking-wide text-slate-800">{label}</span>
      {hint && <span className="mt-1 block text-xs leading-relaxed text-slate-500">{hint}</span>}
      <div className="mt-2">{children}</div>
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  )
}

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-all duration-150 placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10'

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputClass} />
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} rows={props.rows ?? 3} className={inputClass} />
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={`${inputClass} appearance-none pr-9`}>
        {props.children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400"
        strokeWidth={2}
      />
    </div>
  )
}

export function YesNoToggle({
  value,
  onChange,
  yesLabel = 'Yes',
  noLabel = 'No',
}: {
  value: boolean | null
  onChange: (v: boolean) => void
  yesLabel?: string
  noLabel?: string
}) {
  const instanceId = useId()
  return (
    <div className="relative inline-flex overflow-hidden rounded-full border border-slate-200 bg-slate-50 p-0.5">
      {[
        { key: 'yes', label: yesLabel, active: value === true },
        { key: 'no', label: noLabel, active: value === false },
      ].map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key === 'yes')}
          className={`relative z-10 rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-200 ${
            opt.active ? 'text-white' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          {opt.active && (
            <motion.span
              layoutId={`toggle-pill-${instanceId}`}
              className="absolute inset-0 -z-10 rounded-full bg-brand-primary"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

const CALLOUT_ICON = { info: Info, warning: AlertTriangle, critical: AlertCircle }

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'critical'
  title?: string
  children: ReactNode
}) {
  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    critical: 'border-rose-200 bg-rose-50 text-rose-900',
  }[tone]
  const iconStyles = {
    info: 'text-sky-500',
    warning: 'text-amber-500',
    critical: 'text-rose-500',
  }[tone]
  const Icon = CALLOUT_ICON[tone]
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${styles}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconStyles}`} strokeWidth={2.25} />
      <div>
        {title && <p className="mb-0.5 font-semibold">{title}</p>}
        <div className="leading-relaxed">{children}</div>
      </div>
    </motion.div>
  )
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="card-shadow card-shadow-hover rounded-2xl border border-slate-200/80 bg-white p-4 transition-shadow duration-200"
    >
      {children}
    </motion.div>
  )
}

export function RepeaterHeader({
  title,
  onAdd,
  addLabel = 'Add another',
}: {
  title: string
  onAdd: () => void
  addLabel?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <motion.button
        type="button"
        onClick={onAdd}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.96 }}
        className="inline-flex items-center gap-1 rounded-full border border-brand-secondary px-3 py-1 text-xs font-medium text-brand-secondary-ink transition-colors hover:bg-brand-secondary/10"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
        {addLabel}
      </motion.button>
    </div>
  )
}

export function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 transition-colors hover:text-rose-600"
    >
      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
      Remove
    </button>
  )
}
