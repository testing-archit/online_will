'use client'

import { listLawyerCases } from '../../src/lib/backendClient'
import { CaseList } from '../../src/portals/staff/CaseList'

export default function Page() {
  return <CaseList fetchCases={listLawyerCases} basePath="/lawyer" subtitle="Wills you're assigned to review or advise on." />
}
