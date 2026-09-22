import { newId } from './id'
import type { AssistantExtraction, Beneficiary, ImmovableAsset, WillData } from './types'

const BENEFICIARY_PATTERNS = [
  { pattern: /\b(daughter|beti)\b/i, label: 'Daughter', relationship: 'child' as const },
  { pattern: /\b(son|beta)\b/i, label: 'Son', relationship: 'child' as const },
  { pattern: /\b(wife|spouse|husband)\b/i, label: 'Spouse', relationship: 'spouse' as const },
  { pattern: /\b(mother|father|parent)\b/i, label: 'Parent', relationship: 'parent' as const },
]

const ASSET_PATTERNS = [
  { pattern: /\b(house|flat|apartment|property|plot|villa)\b/i, type: 'Immovable property' },
  { pattern: /\b(mutual fund|mf|portfolio|stock|shares|demat)\b/i, type: 'Investment' },
  { pattern: /\b(fd|fixed deposit|bank account|deposit)\b/i, type: 'Bank account / fixed deposit' },
  { pattern: /\b(policy|insurance)\b/i, type: 'Insurance policy' },
  { pattern: /\b(jewellery|gold|car|vehicle|art)\b/i, type: 'Valuable' },
]

export function extractEstateIntent(statement: string): AssistantExtraction {
  const assetMatch = ASSET_PATTERNS.find((candidate) => candidate.pattern.test(statement))
  const beneficiaryMatch = BENEFICIARY_PATTERNS.find((candidate) => candidate.pattern.test(statement))
  const locationMatch = statement.match(/\b(?:in|at)\s+([A-Z][A-Za-z\s]+?)(?:\s+(?:which|that|to|for|and)|[.!,]|$)/)

  const assetDescription = [
    locationMatch?.[1] ? `${locationMatch[1].trim()} ${assetMatch?.type ?? 'asset'}` : '',
    assetMatch ? assetMatch.type : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const confidenceSignals = [assetMatch, beneficiaryMatch, /want|give|go to|inherit|assign/i.test(statement)].filter(Boolean).length

  return {
    id: newId(),
    originalStatement: statement,
    assetDescription: assetDescription || statement.slice(0, 80),
    assetType: assetMatch?.type ?? 'Unclassified asset',
    intendedBeneficiary: beneficiaryMatch?.label ?? '',
    distributionInstruction: beneficiaryMatch
      ? `${assetDescription || 'This asset'} to ${beneficiaryMatch.label}`
      : 'Beneficiary not detected',
    confidence: Math.round((confidenceSignals / 3) * 100) / 100,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
}

export function applyConfirmedExtraction(data: WillData, extraction: AssistantExtraction): WillData {
  const next: WillData = {
    ...data,
    assistantIntake: {
      ...data.assistantIntake,
      extractions: data.assistantIntake.extractions.map((item) =>
        item.id === extraction.id ? { ...item, status: 'confirmed' } : item,
      ),
    },
  }

  if (extraction.assetType === 'Immovable property') {
    next.assets = {
      ...next.assets,
      immovableAssets: [
        ...next.assets.immovableAssets,
        newImmovableAsset(extraction.assetDescription),
      ],
    }
  }

  if (extraction.intendedBeneficiary) {
    next.distribution = {
      ...next.distribution,
      scheme: next.distribution.scheme || 'itemized',
      beneficiaries: [
        ...next.distribution.beneficiaries,
        newBeneficiary(extraction.intendedBeneficiary, extraction.distributionInstruction),
      ],
    }
  }

  return next
}

export function dismissExtraction(data: WillData, extractionId: string): WillData {
  return {
    ...data,
    assistantIntake: {
      ...data.assistantIntake,
      extractions: data.assistantIntake.extractions.map((item) =>
        item.id === extractionId ? { ...item, status: 'dismissed' } : item,
      ),
    },
  }
}

function newImmovableAsset(address: string): ImmovableAsset {
  return {
    id: newId(),
    address,
    surveyNumber: '',
    registryDetails: '',
    ownershipShare: '',
  }
}

function newBeneficiary(name: string, share: string): Beneficiary {
  return {
    id: newId(),
    name,
    relationship: name === 'Daughter' || name === 'Son' ? 'child' : name === 'Spouse' ? 'spouse' : 'other',
    share,
    substituteBeneficiary: '',
  }
}
