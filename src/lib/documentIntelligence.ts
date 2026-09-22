import { newId } from './id'
import { formatInr, parseInr, valuesDiffer } from './money'
import type { ExtractedAsset, ExtractedAssetKind, VaultDocument, VaultDocumentCategory, WillData } from './types'

export const VAULT_CATEGORIES: VaultDocumentCategory[] = [
  'pan',
  'id',
  'property',
  'bank',
  'cas',
  'demat',
  'insurance',
  'loan',
  'business',
  'vehicle',
  'existing-will',
  'unknown',
]

export const CATEGORY_LABEL: Record<VaultDocumentCategory, string> = {
  pan: 'PAN',
  id: 'ID proof',
  property: 'Property document',
  bank: 'Bank statement / FD',
  cas: 'CAS (mutual funds)',
  demat: 'Demat statement',
  insurance: 'Insurance policy',
  loan: 'Loan document',
  business: 'Business document',
  vehicle: 'Vehicle document',
  'existing-will': 'Existing Will / Codicil',
  unknown: 'Unclassified',
}

// Order matters: specific document types are tested before generic ones, so a
// "CAS statement" is a CAS and not a bank statement. Keep in sync with server/documents.mjs.
const CATEGORY_RULES: [VaultDocumentCategory, RegExp][] = [
  ['existing-will', /\b(will|codicil|testament)\b/],
  ['loan', /\b(loan|mortgage|pledge|emi)\b/],
  ['cas', /\b(cas|consolidated account)\b/],
  ['demat', /\b(demat|holdings?|nsdl|cdsl)\b/],
  ['insurance', /\b(insurance|policy|lic|premium)\b/],
  ['property', /\b(property|deed|registry|khasra|khatauni|flat|plot|sale deed|conveyance)\b/],
  ['bank', /\b(bank|passbook|fd|fixed deposit|account statement|statement)\b/],
  ['business', /\b(company|business|partnership|llp|shareholding|moa|aoa)\b/],
  ['vehicle', /\b(vehicle|car|rc|registration certificate)\b/],
  ['pan', /\bpan\b/],
  ['id', /\b(aadhaar|aadhar|passport|voter|driving licen[sc]e|id)\b/],
]

/** `\b` treats "_" as a word character, so separators are normalised first ("PAN_card.pdf" → "pan card pdf"). */
export function classifyFileName(fileName: string): VaultDocumentCategory {
  const normalized = fileName.toLowerCase().replace(/[_.-]+/g, ' ')
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(normalized))?.[0] ?? 'unknown'
}

export function classifyDocument(file: File, data: WillData): VaultDocument {
  const category = classifyFileName(file.name)
  const extractedMetadata = extractMetadataFromName(file.name)
  const document: VaultDocument = {
    id: newId(),
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream',
    category,
    confidence: category === 'unknown' ? 0.25 : 0.72,
    extractedMetadata,
    reconciliationNotes: [],
    extractedAssets: [],
    status: 'uploaded',
    createdAt: new Date().toISOString(),
  }
  return refreshReconciliation(document, data)
}

export function confirmDocument(document: VaultDocument): VaultDocument {
  return { ...document, status: 'confirmed' }
}

/** Manual correction: the user overrides the category; reconciliation is re-run against the new category. */
export function recategorizeDocument(document: VaultDocument, category: VaultDocumentCategory, data: WillData): VaultDocument {
  return refreshReconciliation({ ...document, category, confidence: Math.max(document.confidence, 0.9), status: 'classified' }, data)
}

export function refreshReconciliation(document: VaultDocument, data: WillData): VaultDocument {
  const notes = reconcileDocument(document, data)
  const needsReview = document.category === 'unknown' || notes.length > 0 || document.confidence < 0.5
  return {
    ...document,
    reconciliationNotes: notes,
    status: document.status === 'confirmed' ? 'confirmed' : needsReview ? 'needs_review' : 'classified',
  }
}

function extractMetadataFromName(fileName: string): Record<string, string> {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '')
  const year = fileName.match(/\b(20\d{2}|19\d{2})\b/)?.[1]
  const possibleValue = fileName.match(/(?:rs\.?|inr|₹)\s?([\d.,]+)\s?(cr|crore|lakh|lac)?/i)

  return {
    title: withoutExtension.replace(/[-_]+/g, ' '),
    year: year ?? '',
    valueReference: possibleValue?.[0] ?? '',
  }
}

// ----------------------------------------------------------- reconciliation

const OWNER_KEYS = ['owner', 'owners', 'holder', 'accountHolder', 'policyHolder', 'name']
const VALUE_KEYS = ['value', 'estimatedValue', 'marketValue', 'sumAssured', 'balance', 'valueReference']

function firstMetadata(metadata: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const found = Object.entries(metadata).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase())
    if (found?.[1]?.trim()) return found[1].trim()
  }
  return ''
}

function nameTokens(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1)
}

function looselySamePerson(a: string, b: string) {
  const left = nameTokens(a)
  const right = nameTokens(b)
  if (!left.length || !right.length) return true // nothing to compare
  return left.some((token) => right.includes(token))
}

function splitOwners(text: string) {
  return text
    .split(/\s*(?:&|\band\b|,|\/|;)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function reconcileDocument(document: VaultDocument, data: WillData): string[] {
  const { category, extractedMetadata: metadata } = document
  const notes: string[] = []

  if (category === 'property' && data.assets.immovableAssets.length === 0) {
    notes.push('Property document uploaded but no immovable property is listed in the questionnaire.')
  }
  if ((category === 'bank' || category === 'demat' || category === 'cas') && data.assets.bankAccounts.length === 0 && data.assets.investments.length === 0) {
    notes.push('Financial document uploaded but no matching bank or investment asset is listed.')
  }
  if (category === 'insurance' && !data.insurance.hasPolicies) {
    notes.push('Insurance document uploaded but the questionnaire says no policies are held.')
  }
  if (category === 'loan' && data.assets.hasEncumberedAssets === false) {
    notes.push('Loan document uploaded but the questionnaire says no assets are encumbered.')
  }
  if (category === 'existing-will' && data.revocation.hasPriorWills === false) {
    notes.push('Existing Will/Codicil uploaded but the questionnaire says there are no prior Wills.')
  }

  // Ownership: does the document name the person the questionnaire says owns the asset?
  const owner = firstMetadata(metadata, OWNER_KEYS)
  const testator = data.personal.fullLegalName.trim()
  if (owner && testator && category !== 'existing-will' && !looselySamePerson(owner, testator)) {
    notes.push(`The document names "${owner}" as holder/owner, but the testator is recorded as "${testator}". Please verify ownership information.`)
  }
  if (category === 'property' && owner) {
    const owners = splitOwners(owner)
    const fullShare = data.assets.immovableAssets.some((asset) => Number.parseFloat(asset.ownershipShare) === 100)
    if (owners.length > 1 && fullShare) {
      notes.push(`The document lists multiple owners (${owners.join(', ')}) but the questionnaire records your ownership share as 100%. Please verify ownership information.`)
    }
  }

  // Value: compare the document's value against what the user recorded for the matching asset.
  const documentValueText = firstMetadata(metadata, VALUE_KEYS)
  const documentValue = parseInr(documentValueText)
  if (documentValue !== null) {
    const match = findMatchingAsset(document, data)
    if (match?.recorded !== undefined && match.recorded !== null) {
      if (valuesDiffer(documentValue, match.recorded)) {
        notes.push(`Value mismatch for ${match.label}: the document shows ${formatInr(documentValue)}, the questionnaire says ${formatInr(match.recorded)}. Please verify.`)
      }
    } else {
      notes.push(`Value reference detected in the document/file name: ${documentValueText}. Add or verify the estimated value in the questionnaire.`)
    }
  }

  // Insurance specifics.
  if (category === 'insurance') {
    const policyNumber = firstMetadata(metadata, ['policyNumber', 'identifier'])
    if (policyNumber && data.insurance.policies.length > 0) {
      const digits = policyNumber.replace(/\W/g, '').toLowerCase()
      const known = data.insurance.policies.some((policy) => policy.policyNumber.replace(/\W/g, '').toLowerCase() === digits)
      if (!known) notes.push(`Policy number ${policyNumber} on the document does not match any policy in the questionnaire.`)
    }
    const nominee = firstMetadata(metadata, ['nominee'])
    if (nominee && data.insurance.policies.length > 0 && !data.insurance.policies.some((policy) => policy.nomineeName && looselySamePerson(policy.nomineeName, nominee))) {
      notes.push(`Nominee "${nominee}" on the document differs from the nominee recorded in the questionnaire. Please verify.`)
    }
  }

  return notes
}

function findMatchingAsset(document: VaultDocument, data: WillData): { label: string; recorded: number | null | undefined } | null {
  const haystack = `${document.fileName} ${Object.values(document.extractedMetadata).join(' ')}`.toLowerCase()
  const overlaps = (text: string) =>
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !['road', 'street', 'flat', 'house', 'nagar', 'sector'].includes(word))
      .some((word) => haystack.includes(word))

  if (document.category === 'property') {
    const assets = data.assets.immovableAssets.filter((asset) => asset.address.trim())
    const asset = assets.find((candidate) => overlaps(candidate.address)) ?? (assets.length === 1 ? assets[0] : undefined)
    return asset ? { label: asset.address, recorded: parseInr(asset.estimatedValue) } : null
  }
  if (document.category === 'bank') {
    const asset = data.assets.bankAccounts.find((candidate) => overlaps(candidate.bankName)) ?? (data.assets.bankAccounts.length === 1 ? data.assets.bankAccounts[0] : undefined)
    return asset ? { label: asset.bankName || 'bank account', recorded: parseInr(asset.estimatedValue) } : null
  }
  if (document.category === 'cas' || document.category === 'demat') {
    const asset = data.assets.investments.find((candidate) => overlaps(candidate.description) || overlaps(candidate.type)) ?? (data.assets.investments.length === 1 ? data.assets.investments[0] : undefined)
    return asset ? { label: asset.description || asset.type, recorded: parseInr(asset.estimatedValue) } : null
  }
  return null
}

// --------------------------------------------------- AI result integration

const ASSET_KINDS: ExtractedAssetKind[] = ['immovable', 'bank', 'investment', 'insurance', 'valuable']
const text = (value: unknown, max = 300) => (typeof value === 'string' ? value : value == null ? '' : String(value)).trim().slice(0, max)

/**
 * Merge a backend analysis into the locally classified document. The backend
 * is treated as untrusted input: categories are validated, metadata is forced
 * to strings, and an AI result can never mark a document "confirmed".
 */
export function mergeBackendAnalysis(local: VaultDocument, remote: unknown, data: WillData): VaultDocument {
  if (!remote || typeof remote !== 'object') return local
  const raw = remote as Record<string, unknown>

  const category = VAULT_CATEGORIES.includes(raw.category as VaultDocumentCategory) ? (raw.category as VaultDocumentCategory) : local.category
  const confidenceNumber = Number(raw.confidence)
  const confidence = Number.isFinite(confidenceNumber) ? Math.min(1, Math.max(0, confidenceNumber)) : local.confidence

  const metadata: Record<string, string> = { ...local.extractedMetadata }
  if (raw.extractedMetadata && typeof raw.extractedMetadata === 'object') {
    for (const [key, value] of Object.entries(raw.extractedMetadata as Record<string, unknown>).slice(0, 20)) {
      const cleaned = typeof value === 'object' && value !== null ? JSON.stringify(value).slice(0, 300) : text(value)
      if (cleaned) metadata[text(key, 60)] = cleaned
    }
  }

  const aiNotes = (Array.isArray(raw.reconciliationNotes) ? raw.reconciliationNotes : []).map((note) => text(note)).filter(Boolean)
  const extractedAssets: ExtractedAsset[] = (Array.isArray(raw.extractedAssets) ? raw.extractedAssets : [])
    .slice(0, 25)
    .map((item): ExtractedAsset => {
      const source = (item ?? {}) as Record<string, unknown>
      return {
        id: newId(),
        kind: ASSET_KINDS.includes(source.kind as ExtractedAssetKind) ? (source.kind as ExtractedAssetKind) : 'investment',
        label: text(source.label, 200),
        identifier: text(source.identifier, 100),
        holder: text(source.holder, 120),
        nominee: text(source.nominee, 120),
        value: text(source.value, 60),
        status: 'pending',
      }
    })
    .filter((item) => item.label || item.identifier)

  const merged: VaultDocument = {
    ...local,
    uploadId: local.uploadId,
    category,
    confidence,
    extractedMetadata: metadata,
    extractedAssets,
    status: category === 'unknown' || confidence < 0.5 ? 'needs_review' : 'classified',
  }
  const reconciled = refreshReconciliation(merged, data)
  return { ...reconciled, reconciliationNotes: Array.from(new Set([...reconciled.reconciliationNotes, ...aiNotes])) }
}

/** Add one AI-found asset to the estate — only ever called from an explicit user action. */
export function acceptExtractedAsset(data: WillData, documentId: string, assetId: string): WillData {
  const document = data.documentVault.documents.find((item) => item.id === documentId)
  const found = document?.extractedAssets?.find((item) => item.id === assetId)
  if (!document || !found) return data

  const next: WillData = { ...data, assets: { ...data.assets }, insurance: { ...data.insurance } }
  const identifierKnown = (identifier: string, known: string[]) =>
    Boolean(identifier) && known.some((value) => value.replace(/\W/g, '').toLowerCase() === identifier.replace(/\W/g, '').toLowerCase())

  switch (found.kind) {
    case 'immovable':
      next.assets.immovableAssets = [
        ...data.assets.immovableAssets,
        { id: newId(), address: found.label, surveyNumber: found.identifier, registryDetails: '', ownershipShare: '', estimatedValue: found.value },
      ]
      break
    case 'bank':
      if (!identifierKnown(found.identifier, data.assets.bankAccounts.map((account) => account.accountNumber))) {
        next.assets.bankAccounts = [
          ...data.assets.bankAccounts,
          { id: newId(), bankName: found.label, branch: '', accountNumber: found.identifier, estimatedValue: found.value, nomineeName: found.nominee },
        ]
      }
      break
    case 'investment':
      if (!identifierKnown(found.identifier, data.assets.investments.map((investment) => investment.identifier))) {
        next.assets.investments = [
          ...data.assets.investments,
          {
            id: newId(),
            type: document.category === 'demat' ? 'Demat' : document.category === 'cas' ? 'Mutual Fund' : 'Investment',
            identifier: found.identifier,
            description: found.label,
            estimatedValue: found.value,
            nomineeName: found.nominee,
          },
        ]
      }
      break
    case 'insurance':
      if (!identifierKnown(found.identifier, data.insurance.policies.map((policy) => policy.policyNumber))) {
        next.insurance = {
          hasPolicies: true,
          policies: [
            ...data.insurance.policies,
            { id: newId(), insurer: found.label, policyNumber: found.identifier, nomineeName: found.nominee, nomineeRelationship: '', alignWithWill: null },
          ],
        }
      }
      break
    case 'valuable':
      next.assets.valuables = [...data.assets.valuables, { id: newId(), description: found.label, estimatedValue: found.value }]
      break
  }

  next.documentVault = {
    documents: data.documentVault.documents.map((item) =>
      item.id === documentId
        ? { ...item, extractedAssets: item.extractedAssets?.map((asset) => (asset.id === assetId ? { ...asset, status: 'added' as const } : asset)) }
        : item,
    ),
  }
  return next
}

export function ignoreExtractedAsset(document: VaultDocument, assetId: string): VaultDocument {
  return {
    ...document,
    extractedAssets: document.extractedAssets?.map((asset) => (asset.id === assetId ? { ...asset, status: 'ignored' as const } : asset)),
  }
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
