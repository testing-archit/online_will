import { describe, expect, it } from 'vitest'
import { defaultWillData } from './defaultData'
import {
  acceptExtractedAsset,
  classifyDocument,
  classifyFileName,
  confirmDocument,
  formatFileSize,
  ignoreExtractedAsset,
  reconcileDocument,
  recategorizeDocument,
  refreshReconciliation,
} from './documentIntelligence'
import { newId } from './id'
import type { VaultDocument, WillData } from './types'

function doc(overrides: Partial<VaultDocument>): VaultDocument {
  return {
    id: newId(),
    fileName: 'file.pdf',
    fileSize: 1,
    mimeType: 'application/pdf',
    category: 'property',
    confidence: 0.9,
    extractedMetadata: {},
    reconciliationNotes: [],
    status: 'classified',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function willWith(overrides: (data: WillData) => void): WillData {
  const data = defaultWillData()
  overrides(data)
  return data
}

describe('classifyFileName', () => {
  it('classifies by category, testing more specific patterns before generic ones', () => {
    expect(classifyFileName('demat_holdings_statement.pdf')).toBe('demat')
    expect(classifyFileName('LIC_premium_receipt.pdf')).toBe('insurance')
    expect(classifyFileName('aadhaar_card.pdf')).toBe('id')
    expect(classifyFileName('company_moa.pdf')).toBe('business')
    expect(classifyFileName('car_rc.pdf')).toBe('vehicle')
    expect(classifyFileName('last_will_and_testament.pdf')).toBe('existing-will')
  })

  it('classifies by whole words, not substrings (a filename containing "cash" is not a CAS)', () => {
    expect(classifyFileName('cash_flow_plan.pdf')).toBe('unknown')
  })
})

describe('classifyDocument (full File pipeline)', () => {
  it('classifies, extracts metadata from the filename, and reconciles against the questionnaire', () => {
    const file = new File(['x'], 'Sector62-Noida-2024-₹2.5Cr.pdf', { type: 'application/pdf' })
    const document = classifyDocument(file, defaultWillData())
    expect(document.category).toBe('unknown') // no category keyword in this filename
    expect(document.extractedMetadata.year).toBe('2024')
    expect(document.extractedMetadata.valueReference).toMatch(/2\.5/)
    expect(document.status).toBe('needs_review') // unknown category always needs review
  })

  it('falls back to a generic MIME type when the browser reports none', () => {
    const file = new File(['x'], 'notes.pdf', { type: '' })
    expect(classifyDocument(file, defaultWillData()).mimeType).toBe('application/octet-stream')
  })
})

describe('confirmDocument / recategorizeDocument / refreshReconciliation', () => {
  it('marks a document confirmed regardless of its reconciliation notes', () => {
    const confirmed = confirmDocument(doc({ status: 'needs_review', reconciliationNotes: ['something to check'] }))
    expect(confirmed.status).toBe('confirmed')
  })

  it('re-runs reconciliation against the new category and raises confidence', () => {
    const data = willWith((d) => (d.insurance.hasPolicies = false))
    const recategorized = recategorizeDocument(doc({ category: 'property', confidence: 0.3 }), 'insurance', data)
    expect(recategorized.category).toBe('insurance')
    expect(recategorized.confidence).toBeGreaterThanOrEqual(0.9)
    expect(recategorized.reconciliationNotes.join(' ')).toMatch(/no policies are held/)
  })

  it('keeps a confirmed document confirmed even if it now needs review', () => {
    const data = willWith((d) => (d.insurance.hasPolicies = false))
    const refreshed = refreshReconciliation(doc({ category: 'insurance', status: 'confirmed' }), data)
    expect(refreshed.status).toBe('confirmed')
  })

  it('marks an otherwise-clean, non-unknown document classified (not needing review)', () => {
    const data = willWith((d) => {
      d.assets.immovableAssets = [{ id: 'p1', address: 'Sector 62', surveyNumber: '', registryDetails: '', ownershipShare: '100' }]
    })
    const refreshed = refreshReconciliation(doc({ category: 'property', confidence: 0.9, status: 'uploaded' }), data)
    expect(refreshed.status).toBe('classified')
    expect(refreshed.reconciliationNotes).toHaveLength(0)
  })
})

describe('reconcileDocument: category-specific checks', () => {
  it('flags a loan document when no assets were said to be encumbered', () => {
    const data = willWith((d) => (d.assets.hasEncumberedAssets = false))
    const notes = reconcileDocument(doc({ category: 'loan' }), data)
    expect(notes.join(' ')).toMatch(/no assets are encumbered/)
  })

  it('flags an existing-will upload when the questionnaire says there are no prior wills', () => {
    const data = willWith((d) => (d.revocation.hasPriorWills = false))
    const notes = reconcileDocument(doc({ category: 'existing-will' }), data)
    expect(notes.join(' ')).toMatch(/no prior Wills/)
  })

  it('flags a policy number that does not match any recorded policy', () => {
    const data = willWith((d) => {
      d.insurance.policies = [{ id: 'p1', insurer: 'LIC', policyNumber: 'ABC-123', nomineeName: '', nomineeRelationship: '', alignWithWill: null }]
    })
    const notes = reconcileDocument(doc({ category: 'insurance', extractedMetadata: { policyNumber: 'XYZ-999' } }), data)
    expect(notes.join(' ')).toMatch(/does not match any policy/)
  })

  it('flags a nominee on the document that differs from the one recorded', () => {
    const data = willWith((d) => {
      d.insurance.policies = [{ id: 'p1', insurer: 'LIC', policyNumber: 'ABC-123', nomineeName: 'Priya Mehta', nomineeRelationship: 'spouse', alignWithWill: true }]
    })
    const notes = reconcileDocument(doc({ category: 'insurance', extractedMetadata: { nominee: 'Someone Else' } }), data)
    expect(notes.join(' ')).toMatch(/differs from the nominee recorded/)
  })

  it('flags a value mentioned in the document/filename with no matching asset at all', () => {
    const notes = reconcileDocument(doc({ category: 'bank', extractedMetadata: { value: '5 lakh' } }), defaultWillData())
    expect(notes.join(' ')).toMatch(/Add or verify the estimated value/)
  })
})

describe('acceptExtractedAsset: every asset kind', () => {
  function withExtracted(kind: 'immovable' | 'bank' | 'investment' | 'insurance' | 'valuable') {
    const document = doc({
      category: kind === 'investment' ? 'demat' : 'unknown',
      extractedAssets: [{ id: 'x1', kind, label: 'Label', identifier: 'ID-1', holder: '', nominee: 'Nominee Name', value: '5 lakh', status: 'pending' }],
    })
    const data = defaultWillData()
    data.documentVault.documents = [document]
    return { data, document }
  }

  it('adds an immovable asset', () => {
    const { data, document } = withExtracted('immovable')
    const next = acceptExtractedAsset(data, document.id, 'x1')
    expect(next.assets.immovableAssets).toHaveLength(1)
    expect(next.assets.immovableAssets[0].address).toBe('Label')
  })

  it('adds an investment asset, typed by the source document category', () => {
    const { data, document } = withExtracted('investment')
    const next = acceptExtractedAsset(data, document.id, 'x1')
    expect(next.assets.investments).toHaveLength(1)
    expect(next.assets.investments[0].type).toBe('Demat')
    expect(next.assets.investments[0].nomineeName).toBe('Nominee Name')
  })

  it('adds an insurance policy and sets hasPolicies to true', () => {
    const { data, document } = withExtracted('insurance')
    const next = acceptExtractedAsset(data, document.id, 'x1')
    expect(next.insurance.hasPolicies).toBe(true)
    expect(next.insurance.policies).toHaveLength(1)
  })

  it('adds a valuable', () => {
    const { data, document } = withExtracted('valuable')
    const next = acceptExtractedAsset(data, document.id, 'x1')
    expect(next.assets.valuables).toHaveLength(1)
    expect(next.assets.valuables[0].description).toBe('Label')
  })

  it('does nothing for an unknown document or asset id', () => {
    const data = defaultWillData()
    expect(acceptExtractedAsset(data, 'missing-doc', 'x1')).toBe(data)
  })
})

describe('ignoreExtractedAsset and formatFileSize', () => {
  it('marks a single extracted asset ignored without touching the others', () => {
    const document = doc({
      extractedAssets: [
        { id: 'x1', kind: 'bank', label: 'A', identifier: '', holder: '', nominee: '', value: '', status: 'pending' },
        { id: 'x2', kind: 'bank', label: 'B', identifier: '', holder: '', nominee: '', value: '', status: 'pending' },
      ],
    })
    const updated = ignoreExtractedAsset(document, 'x1')
    expect(updated.extractedAssets?.find((a) => a.id === 'x1')?.status).toBe('ignored')
    expect(updated.extractedAssets?.find((a) => a.id === 'x2')?.status).toBe('pending')
  })

  it('formats byte sizes for display', () => {
    expect(formatFileSize(500)).toBe('500 B')
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
