'use client'

import { listAdvisorCases } from '../../src/lib/backendClient'
import { CaseList } from '../../src/portals/staff/CaseList'

export default function Page() {
  return <CaseList fetchCases={listAdvisorCases} basePath="/advisor" subtitle="Clients you're assigned to advise on." />
}
