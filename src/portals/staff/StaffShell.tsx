'use client'

import { Loader2, LogOut, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Suspense, type ReactNode } from 'react'
import { signOut, type SessionUser } from '../../lib/backendClient'

export interface StaffNavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

/** Left-nav-rail shell shared by every staff portal (lawyer/advisor/admin) -- only the nav items differ.
 * `children` is the current page (App Router layouts receive it directly; no <Outlet/> needed). */
export function StaffShell({ user, navItems, children }: { user: SessionUser; navItems: StaffNavItem[]; children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <div className="flex min-h-screen bg-porcelain">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200/80 bg-white px-4 py-6">
        <img src="/octaraa-logo.png" alt="Octaraa" className="mb-8 h-6 w-auto self-start" />
        <nav className="flex flex-col gap-1">
          {navItems.map(({ to, label, icon: Icon, end }) => {
            const isActive = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`)
            return (
              <Link
                key={to}
                href={to}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-brand-primary/5 text-brand-primary' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto border-t border-slate-200/80 pt-4">
          <p className="truncate text-xs text-slate-500" title={user.email}>
            {user.email}
          </p>
          <button
            type="button"
            onClick={() => {
              signOut()
              router.replace('/staff/login')
            }}
            className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 transition hover:text-slate-800"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">
        {/* Pages load on first visit; the shell and navigation stay put meanwhile. */}
        <Suspense fallback={<Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading" />}>{children}</Suspense>
      </main>
    </div>
  )
}
