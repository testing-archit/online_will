'use client'

import { Loader2, UserPlus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { createStaffAccount, listStaffAccounts, setStaffAccountStatus, type SessionRole, type StaffAccount } from '../../lib/backendClient'
import { PortalCard } from '../shared'

const CREATABLE_ROLES: SessionRole[] = ['lawyer', 'advisor', 'admin']

export function StaffAccounts() {
  const [staff, setStaff] = useState<StaffAccount[] | 'loading' | 'error'>('loading')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<SessionRole>('lawyer')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const refresh = async () => setStaff((await listStaffAccounts()) ?? 'error')

  useEffect(() => {
    let cancelled = false
    void listStaffAccounts().then((accounts) => {
      if (!cancelled) setStaff(accounts ?? 'error')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setCreating(true)
    setError('')
    const result = await createStaffAccount({ email: email.trim(), password, fullName: fullName.trim(), role })
    setCreating(false)
    if (!result.ok) {
      setError(result.error || 'Could not create the account')
      return
    }
    setEmail('')
    setPassword('')
    setFullName('')
    await refresh()
  }

  return (
    <div>
      <h1 className="font-display text-xl text-slate-900">Staff accounts</h1>
      <p className="mt-1 text-sm text-slate-500">Create and manage lawyer, advisor, and admin sign-ins.</p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {staff === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {staff === 'error' && <p className="text-sm text-rose-600">Could not load staff accounts.</p>}
          {Array.isArray(staff) && (
            <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Email</th>
                    <th className="px-5 py-3">Role</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {staff.map((account) => (
                    <tr key={account.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-5 py-3 font-medium text-slate-800">{account.fullName}</td>
                      <td className="px-5 py-3 text-slate-600">{account.email}</td>
                      <td className="px-5 py-3 text-slate-600 capitalize">{account.role}</td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${account.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{account.status}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          onClick={async () => {
                            await setStaffAccountStatus(account.id, account.status === 'active' ? 'disabled' : 'active')
                            await refresh()
                          }}
                          className="text-xs font-medium text-brand-primary hover:underline"
                        >
                          {account.status === 'active' ? 'Disable' : 'Re-enable'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <PortalCard title="New account">
          <form onSubmit={submit} className="flex flex-col gap-3">
            <input required type="text" placeholder="Full name" value={fullName} onChange={(event) => setFullName(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-primary" />
            <input required type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-primary" />
            <input required type="password" placeholder="Temporary password (10+ chars)" value={password} onChange={(event) => setPassword(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-primary" />
            <select value={role} onChange={(event) => setRole(event.target.value as SessionRole)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-primary">
              {CREATABLE_ROLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button type="submit" disabled={creating} className="flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Create account
            </button>
            <p className="text-xs text-slate-400">Share this password with them directly; they can change it after signing in.</p>
          </form>
        </PortalCard>
      </div>
    </div>
  )
}
