'use client'

import { Folder, ScrollText, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { RequireRole } from '../../src/portals/RequireRole'
import { StaffShell } from '../../src/portals/staff/StaffShell'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role="admin">
      {(user) => (
        <StaffShell
          user={user}
          navItems={[
            { to: '/admin', label: 'Cases', icon: Folder, end: true },
            { to: '/admin/staff', label: 'Staff', icon: Users },
            { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
          ]}
        >
          {children}
        </StaffShell>
      )}
    </RequireRole>
  )
}
