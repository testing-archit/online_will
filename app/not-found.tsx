import { redirect } from 'next/navigation'

// Matches the SPA's old `<Route path="*" element={<Navigate to="/" replace />} />` -- any unmatched path goes
// straight to the landing page rather than showing a 404.
export default function NotFound() {
  redirect('/')
}
