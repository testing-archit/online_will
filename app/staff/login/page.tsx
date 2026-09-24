import { Suspense } from 'react'
import { StaffLoginPage } from '../../../src/portals/StaffLoginPage'

// useSearchParams() (reading ?from=) requires a Suspense boundary in the App Router.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <StaffLoginPage />
    </Suspense>
  )
}
