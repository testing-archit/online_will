'use client'

import { Scale } from 'lucide-react'
import type { ReactNode } from 'react'
import { RequireRole } from '../../src/portals/RequireRole'
import { StaffShell } from '../../src/portals/staff/StaffShell'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role="lawyer">
      {(user) => (
        <StaffShell user={user} navItems={[{ to: '/lawyer', label: 'Cases', icon: Scale, end: true }]}>
          {children}
        </StaffShell>
      )}
    </RequireRole>
  )
}
