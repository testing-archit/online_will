'use client'

import { CaseDetail } from '../../../../src/portals/staff/CaseDetail'
import { AdminCaseExtras } from '../../../../src/portals/admin/AdminCaseExtras'

export default function Page() {
  return <CaseDetail backPath="/admin" reportType="admin" extraPanel={(data, willId) => <AdminCaseExtras data={data} willId={willId} />} />
}
