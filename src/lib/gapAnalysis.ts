import { detectEstateIssues } from './estateIssues'
import { buildEstateProfile } from './estateProfile'
import { computeLegalFlags } from './legalRules'
import type { WillData } from './types'

export type GapSeverity = 'attention' | 'improvement' | 'strength'

export interface PlanningGap {
  id: string
  severity: GapSeverity
  title: string
  detail: string
}

export interface GapAnalysisReport {
  generatedAt: string
  readinessPercent: number
  gaps: PlanningGap[]
  strengths: PlanningGap[]
}

// Task 40 — consolidated "Estate Planning Gaps" report. These are planning
// gaps, not legal-risk determinations; counsel defines legal risk.
export function buildGapAnalysis(data: WillData): GapAnalysisReport {
  const profile = buildEstateProfile(data)
  const issues = detectEstateIssues(data)
  const flags = computeLegalFlags(data)
  const gaps: PlanningGap[] = []
  const strengths: PlanningGap[] = []

  // Executor fallback
  const alternateExecutors = data.executorsGuardians.executors.filter((e) => e.isAlternate && e.fullName.trim())
  if (alternateExecutors.length === 0) {
    gaps.push({
      id: 'gap-alternate-executor',
      severity: 'attention',
      title: 'No alternate executor',
      detail: 'If the primary executor cannot act, there is no recorded fallback administrator for the estate.',
    })
  }

  // Nomination coverage
  const policiesWithoutNominee = data.insurance.policies.filter(
    (policy) => (policy.insurer.trim() || policy.policyNumber.trim()) && !policy.nomineeName.trim(),
  )
  if (policiesWithoutNominee.length > 0) {
    gaps.push({
      id: 'gap-nominations',
      severity: 'attention',
      title: `${policiesWithoutNominee.length} insurance polic${policiesWithoutNominee.length === 1 ? 'y' : 'ies'} without nomination information`,
      detail: 'Nomination records speed up claim settlement and reduce the chance of proceeds bypassing the intended beneficiary.',
    })
  }

  // Beneficiary consistency
  const inconsistencyIssues = issues.filter((issue) => issue.source === 'contradiction' || issue.source === 'nomination-alignment')
  if (inconsistencyIssues.length > 0) {
    gaps.push({
      id: 'gap-beneficiary-consistency',
      severity: 'attention',
      title: 'Beneficiary inconsistency detected',
      detail: inconsistencyIssues[0].description,
    })
  }

  // Property documents
  const hasPropertyWithoutDocs =
    data.assets.immovableAssets.length > 0 &&
    !data.documentVault.documents.some((document) => document.category === 'property')
  if (hasPropertyWithoutDocs) {
    gaps.push({
      id: 'gap-property-documents',
      severity: 'improvement',
      title: 'Property document missing',
      detail: 'Immovable property is listed in the questionnaire, but no property document has been uploaded to the vault.',
    })
  }

  // Digital assets
  if (data.estateOs.digitalAssets.length === 0) {
    gaps.push({
      id: 'gap-digital-assets',
      severity: 'improvement',
      title: 'Digital assets incomplete',
      detail: 'No digital account instructions (cloud, brokerage, crypto, records) are recorded for the executor.',
    })
  }

  // Substitute beneficiaries
  const beneficiariesWithoutSubstitute = data.distribution.beneficiaries.filter(
    (beneficiary) => beneficiary.name.trim() && !beneficiary.substituteBeneficiary.trim(),
  )
  if (beneficiariesWithoutSubstitute.length > 0) {
    gaps.push({
      id: 'gap-substitute-beneficiaries',
      severity: 'improvement',
      title: `${beneficiariesWithoutSubstitute.length} beneficiary item(s) without a substitute`,
      detail: 'If a beneficiary predeceases the testator, the fallback for their share is not recorded.',
    })
  }

  // Legal review items
  const criticalFlags = flags.filter((flag) => flag.severity === 'critical')
  for (const flag of criticalFlags) {
    gaps.push({ id: `gap-flag-${flag.id}`, severity: 'attention', title: flag.title, detail: flag.description })
  }

  // Strengths — a balanced report shows what is already in good shape.
  if (data.revocation.soundMindDeclaration) {
    strengths.push({
      id: 'strength-sound-mind',
      severity: 'strength',
      title: 'Sound-mind declaration recorded',
      detail: 'The capacity declaration is captured in the draft.',
    })
  }
  if (data.documentVault.documents.some((document) => document.status === 'confirmed')) {
    strengths.push({
      id: 'strength-documents',
      severity: 'strength',
      title: 'Documents confirmed in the vault',
      detail: 'At least one supporting document has been classified and confirmed.',
    })
  }
  if (data.estateOs.reviewEvents.length > 0) {
    strengths.push({
      id: 'strength-reviews',
      severity: 'strength',
      title: 'Ongoing reviews scheduled',
      detail: 'Annual or event-based estate reviews are on the calendar.',
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    readinessPercent: profile.completion.overall,
    gaps,
    strengths,
  }
}
