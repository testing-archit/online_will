import { redirect } from 'next/navigation'

// Matches the SPA's old `<Route path="*" element={<Navigate to="/" replace />} />` -- any unmatched path goes
// straight to the landing page rather than showing a 404.
//
// force-dynamic matters here: without it, production statically prerenders this page at build time, and a
// redirect() called during static generation gets baked into a 404 response with a Location header attached as
// metadata -- not a real 3xx status. Browsers (and curl) only follow an actual redirect status, so a static build
// silently regressed to a real 404 page that never navigates anywhere, caught by testing the live production
// deployment rather than `next dev` (which always executes this per-request, masking the difference).
export const dynamic = 'force-dynamic'

export default function NotFound() {
  redirect('/')
}
