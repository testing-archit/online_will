'use client'

import { Loader2, LogIn } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { loginWithPassword, type SessionRole } from '../lib/backendClient'
import { Field, TextInput } from '../wizard/fields'

const PORTAL_PATH: Partial<Record<SessionRole, string>> = { lawyer: '/lawyer', advisor: '/advisor', admin: '/admin' }

export function StaffLoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [comingSoonRole, setComingSoonRole] = useState<SessionRole | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setComingSoonRole(null)
    const result = await loginWithPassword(email.trim(), password)
    setBusy(false)
    if (!result.ok || !result.role) {
      setError(result.error || 'Incorrect email or password')
      return
    }
    const target = PORTAL_PATH[result.role]
    if (!target) {
      setComingSoonRole(result.role)
      return
    }
    const from = searchParams.get('from')
    router.replace(from && from.startsWith(target) ? from : target)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-porcelain px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img src="/octaraa-logo.png" alt="Octaraa" className="h-8 w-auto" />
          <h1 className="font-display text-lg text-slate-900">Staff sign-in</h1>
        </div>
        <form onSubmit={submit} className="card-shadow flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-6">
          <Field label="Email">
            <TextInput type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Password">
            <TextInput type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          {comingSoonRole && <p className="text-xs text-brand-secondary-ink">Signed in — the {comingSoonRole} portal is coming soon.</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-primary-hover active:translate-y-px disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Sign in
          </button>
        </form>
      </div>
    </div>
  )
}
