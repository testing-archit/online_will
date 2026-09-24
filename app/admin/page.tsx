'use client'

import { listLawyerCases } from '../../src/lib/backendClient'
import { CaseList } from '../../src/portals/staff/CaseList'

export default function Page() {
  return <CaseList fetchCases={listLawyerCases} basePath="/admin" title="All cases" subtitle="Every case across the platform." />
}
