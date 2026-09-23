import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getSession, type SessionRole, type SessionUser } from '../lib/backendClient'

/** Gates a staff portal behind a real, role-checked session -- redirects to the shared login otherwise. */
export function RequireRole({ role, children }: { role: SessionRole; children: (user: SessionUser) => ReactNode }) {
  const location = useLocation()
  const [session, setSession] = useState<SessionUser | null | 'checking'>('checking')

  // Re-checked on every navigation, but the page already shown stays up meanwhile instead of blanking to a spinner.
  useEffect(() => {
    let cancelled = false
    void getSession().then((result) => {
      if (!cancelled) setSession(result)
    })
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  if (session === 'checking') {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Checking your session…</div>
  }
  if (!session || session.role !== role) {
    return <Navigate to="/staff/login" state={{ from: location.pathname }} replace />
  }
  return <>{children(session)}</>
}
