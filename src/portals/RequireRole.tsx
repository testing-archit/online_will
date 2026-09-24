'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getSession, type SessionRole, type SessionUser } from '../lib/backendClient'

/** Gates a staff portal behind a real, role-checked session -- redirects to the shared login otherwise. */
export function RequireRole({ role, children }: { role: SessionRole; children: (user: SessionUser) => ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
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
  }, [pathname])

  // react-router's <Navigate state={{from}}> passed the return path through router state; Next's router has no
  // equivalent, so it rides along as a query param instead (read back in StaffLoginPage).
  useEffect(() => {
    if (session && session !== 'checking' && session.role === role) return
    if (session === 'checking') return
    router.replace(`/staff/login?from=${encodeURIComponent(pathname)}`)
  }, [session, role, pathname, router])

  if (session === 'checking' || !session || session.role !== role) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Checking your session…</div>
  }
  return <>{children(session)}</>
}
