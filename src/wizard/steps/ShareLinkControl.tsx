import { Check, Copy, Link2, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { createShareLink, currentServerWillId, revokeShareLink } from '../../lib/backendClient'

/** Lets the client generate a read-only link (no login) to share their plan -- e.g. with family. Creating a new
 * one invalidates whatever was shared before, so there is never more than one link live at a time. */
export function ShareLinkControl() {
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const willId = currentServerWillId()

  const create = async () => {
    if (!willId) return
    setBusy(true)
    setError('')
    const token = await createShareLink(willId)
    setBusy(false)
    if (!token) {
      setError('Could not create a share link. Try again in a moment.')
      return
    }
    setUrl(`${window.location.origin}/share/${token}`)
  }

  const revoke = async () => {
    if (!willId) return
    setBusy(true)
    await revokeShareLink(willId)
    setBusy(false)
    setUrl(null)
  }

  if (!willId) return null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Link2 className="h-4 w-4 text-brand-primary" />
        Share a read-only summary
      </div>
      <p className="mt-1 text-xs text-slate-500">Anyone with this link can view a summary of your plan and download the Will PDF — no sign-in, no editing. You can revoke it anytime.</p>

      {url ? (
        <div className="mt-3 flex items-center gap-2">
          <input readOnly value={url} className="w-full truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(url)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-primary px-3 py-2 text-xs font-semibold text-white"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={revoke} disabled={busy} className="flex shrink-0 items-center gap-1 text-xs font-medium text-slate-500 hover:text-rose-600 disabled:opacity-50">
            <X className="h-3.5 w-3.5" /> Revoke
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-brand-secondary hover:text-brand-primary disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          Create share link
        </button>
      )}
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </div>
  )
}
