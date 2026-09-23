import { Download, Loader2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import octaraaLogo from '../../assets/octaraa-logo.png'
import { fetchSharedWill } from '../../lib/backendClient'
import { buildEstateProfile, type EstateProfile } from '../../lib/estateProfile'
import type { WillData } from '../../lib/types'
import { CompletionPill, ItemList, PortalCard } from '../shared'

function CenteredMessage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-porcelain px-4 text-center">{children}</div>
}

/** Public, read-only view for whoever holds the share link -- no login, and no editing. */
export function SharedPortalPage() {
  const { token = '' } = useParams()
  const [data, setData] = useState<WillData | 'loading' | 'error'>('loading')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchSharedWill(token).then((result) => {
      if (cancelled) return
      setData(result.ok && result.willData ? result.willData : 'error')
    })
    return () => {
      cancelled = true
    }
  }, [token])

  if (data === 'loading') {
    return (
      <CenteredMessage>
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </CenteredMessage>
    )
  }
  if (data === 'error') {
    return (
      <CenteredMessage>
        <div>
          <img src={octaraaLogo} alt="Octaraa" className="mx-auto mb-4 h-6 w-auto" />
          <p className="text-sm text-slate-500">This link is invalid or has been revoked. Ask for a new one.</p>
        </div>
      </CenteredMessage>
    )
  }

  const profile: EstateProfile = buildEstateProfile(data)

  return (
    <div className="min-h-screen bg-porcelain px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between gap-3">
          <img src={octaraaLogo} alt="Octaraa" className="h-7 w-auto" />
          <button
            type="button"
            disabled={downloading}
            onClick={async () => {
              setDownloading(true)
              const { downloadWillPdf } = await import('../../pdf/generatePdf')
              await downloadWillPdf(data)
              setDownloading(false)
            }}
            className="flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-primary-hover active:translate-y-px disabled:opacity-60"
          >
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download Will
          </button>
        </div>

        <h1 className="font-display text-2xl text-slate-900">{profile.clientName}'s Estate Plan</h1>
        <div className="mt-2">
          <CompletionPill value={profile.completion.overall} />
        </div>
        <p className="mt-4 text-sm text-slate-500">A read-only summary shared by {profile.clientName}. This is not legal advice.</p>

        <div className="mt-8 flex flex-col gap-5">
          <PortalCard title="Family">
            <ItemList items={profile.familyMembers} />
          </PortalCard>
          <PortalCard title="Executors">
            <ItemList items={profile.executors} />
          </PortalCard>
          {profile.guardians.length > 0 && (
            <PortalCard title="Guardians">
              <ItemList items={profile.guardians} />
            </PortalCard>
          )}
          <PortalCard title="Beneficiaries & distribution">
            <ItemList items={profile.distributionInstructions} empty="No distribution instructions recorded yet" />
          </PortalCard>
          <PortalCard title="Assets">
            <ItemList items={profile.assets} />
          </PortalCard>
          {profile.liabilities.length > 0 && (
            <PortalCard title="Liabilities">
              <ItemList items={profile.liabilities} />
            </PortalCard>
          )}
          {profile.insurance.length > 0 && (
            <PortalCard title="Insurance">
              <ItemList items={profile.insurance} />
            </PortalCard>
          )}
          {profile.documents.length > 0 && (
            <PortalCard title="Documents on file">
              <ItemList items={profile.documents} />
            </PortalCard>
          )}
          <PortalCard title="Execution status">
            <ItemList items={profile.executionStatus} />
          </PortalCard>
        </div>
      </div>
    </div>
  )
}
