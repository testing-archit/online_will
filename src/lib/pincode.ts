export interface PincodeLookupResult {
  city: string
  state: string
}

interface PostOffice {
  Name: string
  District: string
  State: string
}

interface PincodeApiResponse {
  Status: string
  PostOffice: PostOffice[] | null
}

// India Post's public PIN code directory. Free, no auth, but best-effort —
// callers must treat the result as a convenience prefill, not a source of
// truth, and keep the underlying fields editable.
const PINCODE_API = 'https://api.postalpincode.in/pincode/'

export async function lookupPincode(pincode: string, signal?: AbortSignal): Promise<PincodeLookupResult | null> {
  const res = await fetch(`${PINCODE_API}${pincode}`, { signal })
  if (!res.ok) return null
  const data = (await res.json()) as PincodeApiResponse[]
  const entry = data[0]
  if (!entry || entry.Status !== 'Success' || !entry.PostOffice?.length) return null
  const office = entry.PostOffice[0]
  return { city: office.District, state: office.State }
}

export function isCompletePincode(value: string): boolean {
  return /^[1-9][0-9]{5}$/.test(value)
}
