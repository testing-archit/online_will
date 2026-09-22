/**
 * Parse free-text Indian money amounts: "₹2.5 Cr", "2.5cr", "50 lakh", "45 lac",
 * "Rs. 1,20,000", "1.2 crore", "25k". Returns rupees, or null when no amount is present.
 */
export function parseInr(input: string | undefined | null): number | null {
  if (!input) return null
  const text = String(input).toLowerCase().replace(/,/g, '')
  const match = text.match(/(\d+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lakh|l|thousand|k|million|mn|m)?\b/)
  if (!match) return null

  const amount = Number.parseFloat(match[1])
  if (!Number.isFinite(amount)) return null
  const unit = match[2] ?? ''
  if (/^cr/.test(unit)) return Math.round(amount * 10_000_000)
  if (/^(l|lakh|lac)/.test(unit)) return Math.round(amount * 100_000)
  if (/^(thousand|k)$/.test(unit)) return Math.round(amount * 1_000)
  if (/^(million|mn|m)$/.test(unit)) return Math.round(amount * 1_000_000)
  return Math.round(amount)
}

export function formatInr(value: number): string {
  if (value >= 10_000_000) return `₹${trim(value / 10_000_000)} Cr`
  if (value >= 100_000) return `₹${trim(value / 100_000)} L`
  return `₹${value.toLocaleString('en-IN')}`
}

function trim(value: number) {
  return Number.parseFloat(value.toFixed(2)).toString()
}

/** True when two amounts differ by more than `tolerance` (default 10%). */
export function valuesDiffer(a: number, b: number, tolerance = 0.1): boolean {
  const larger = Math.max(Math.abs(a), Math.abs(b))
  return larger > 0 && Math.abs(a - b) / larger > tolerance
}
