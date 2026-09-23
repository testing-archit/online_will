import { Briefcase, Folder, Scale, ScrollText, Users } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { listAdvisorCases, listLawyerCases } from './lib/backendClient'
import { LandingPage } from './portals/LandingPage'
import { RequireRole } from './portals/RequireRole'

// Each area loads only when it is visited: someone on the landing page doesn't download the wizard, the voice
// engine or the staff portals up front.
const WizardShell = lazy(() => import('./wizard/WizardShell').then((module) => ({ default: module.WizardShell })))
const StaffLoginPage = lazy(() => import('./portals/StaffLoginPage').then((module) => ({ default: module.StaffLoginPage })))
const SharedPortalPage = lazy(() => import('./portals/client/SharedPortalPage').then((module) => ({ default: module.SharedPortalPage })))
const StaffShell = lazy(() => import('./portals/staff/StaffShell').then((module) => ({ default: module.StaffShell })))
const CaseList = lazy(() => import('./portals/staff/CaseList').then((module) => ({ default: module.CaseList })))
const CaseDetail = lazy(() => import('./portals/staff/CaseDetail').then((module) => ({ default: module.CaseDetail })))
const AdminCaseExtras = lazy(() => import('./portals/admin/AdminCaseExtras').then((module) => ({ default: module.AdminCaseExtras })))
const StaffAccounts = lazy(() => import('./portals/admin/StaffAccounts').then((module) => ({ default: module.StaffAccounts })))
const AuditLogPage = lazy(() => import('./portals/admin/AuditLogPage').then((module) => ({ default: module.AuditLogPage })))

const loading = <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading…</div>

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={loading}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/start" element={<WizardShell />} />
          <Route path="/staff/login" element={<StaffLoginPage />} />
          <Route path="/share/:token" element={<SharedPortalPage />} />

          <Route
            path="/lawyer"
            element={
              <RequireRole role="lawyer">{(user) => <StaffShell user={user} navItems={[{ to: '/lawyer', label: 'Cases', icon: Scale, end: true }]} />}</RequireRole>
            }
          >
            <Route index element={<CaseList fetchCases={listLawyerCases} subtitle="Wills you're assigned to review or advise on." />} />
            <Route path="cases/:willId" element={<CaseDetail backPath="/lawyer" reportType="lawyer" />} />
          </Route>

          <Route
            path="/advisor"
            element={
              <RequireRole role="advisor">{(user) => <StaffShell user={user} navItems={[{ to: '/advisor', label: 'Cases', icon: Briefcase, end: true }]} />}</RequireRole>
            }
          >
            <Route index element={<CaseList fetchCases={listAdvisorCases} subtitle="Clients you're assigned to advise on." />} />
            <Route path="cases/:willId" element={<CaseDetail backPath="/advisor" reportType="advisor" />} />
          </Route>

          <Route
            path="/admin"
            element={
              <RequireRole role="admin">
                {(user) => (
                  <StaffShell
                    user={user}
                    navItems={[
                      { to: '/admin', label: 'Cases', icon: Folder, end: true },
                      { to: '/admin/staff', label: 'Staff', icon: Users },
                      { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
                    ]}
                  />
                )}
              </RequireRole>
            }
          >
            <Route index element={<CaseList fetchCases={listLawyerCases} title="All cases" subtitle="Every case across the platform." />} />
            <Route path="cases/:willId" element={<CaseDetail backPath="/admin" reportType="admin" extraPanel={(data, willId) => <AdminCaseExtras data={data} willId={willId} />} />} />
            <Route path="staff" element={<StaffAccounts />} />
            <Route path="audit" element={<AuditLogPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
