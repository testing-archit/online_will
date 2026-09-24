'use client'

import { Briefcase } from 'lucide-react'
import type { ReactNode } from 'react'
import { RequireRole } from '../../src/portals/RequireRole'
import { StaffShell } from '../../src/portals/staff/StaffShell'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role="advisor">
      {(user) => (
        <StaffShell user={user} navItems={[{ to: '/advisor', label: 'Cases', icon: Briefcase, end: true }]}>
          {children}
        </StaffShell>
      )}
    </RequireRole>
  )
}
