import { computeAge } from './age'
import { buildNominationAlignment, mapAssetsToBeneficiaries, nameMatches } from './assetMapping'
import type { EstateProfileItem } from './estateProfile'
import { getMissingRequiredQuestions } from './questionnaireSchema'
import type { WillData } from './types'

export type EstateIssueSeverity = 'mandatory' | 'review' | 'context'

export interface EstateIssue {
  id: string
  severity: EstateIssueSeverity
  title: string
  description: string
  source: 'questionnaire' | 'deterministic-rule' | 'contextual-check' | 'contradiction' | 'nomination-alignment'
}

const SECTION_IDS = ['personal', 'revocation', 'executors', 'assets', 'insurance', 'distribution', 'funeral', 'execution']

export function detectEstateIssues(data: WillData): EstateIssue[] {
  return [
    ...questionnaireMissingIssues(data),
    ...deterministicCompletenessIssues(data),
    ...contextualIssues(data),
    ...contradictionIssues(data),
    ...nominationAlignmentIssues(data),
  ]
}

export function estateIssuesToItems(issues: EstateIssue[]): EstateProfileItem[] {
  return issues.map((issue) => ({
    id: issue.id,
    title: issue.title,
    subtitle: issue.description,
    meta: `${issue.severity} · ${issue.source}`,
  }))
}

export function hasMandatoryEstateIssues(data: WillData) {
  return detectEstateIssues(data).some((issue) => issue.severity === 'mandatory')
}

function questionnaireMissingIssues(data: WillData): EstateIssue[] {
  return SECTION_IDS.flatMap((sectionId) =>
    getMissingRequiredQuestions(data, sectionId).map((question) => ({
      id: `missing-${question.id}`,
      severity: 'mandatory' as const,
      title: question.label,
      description: question.validationMessage ?? `Required visible answer in ${sectionId}.`,
      source: 'questionnaire' as const,
    })),
  )
}

function parsePercent(share: string): number | null {
  const match = share.match(/(\d+(?:\.\d+)?)\s*%/)
  return match ? Number.parseFloat(match[1]) : null
}

function deterministicCompletenessIssues(data: WillData): EstateIssue[] {
  const issues: EstateIssue[] = []
  const primaryExecutors = data.executorsGuardians.executors.filter((executor) => !executor.isAlternate && executor.fullName.trim())
  const alternateExecutors = data.executorsGuardians.executors.filter((executor) => executor.isAlternate && executor.fullName.trim())

  if (primaryExecutors.length > 0 && alternateExecutors.length === 0) {
    issues.push({
      id: 'no-alternate-executor',
      severity: 'review',
      title: 'No alternate executor named',
      description: 'You have appointed a primary executor but no alternate executor if the first cannot act.',
      source: 'deterministic-rule',
    })
  }

  if (data.executorsGuardians.hasChildren && data.executorsGuardians.hasMinorChildren) {
    const alternateGuardians = data.executorsGuardians.guardians.filter((guardian) => guardian.isAlternate && guardian.fullName.trim())
    if (alternateGuardians.length === 0) {
      issues.push({
        id: 'no-alternate-guardian',
        severity: 'review',
        title: 'No alternate guardian named',
        description: 'You have minor children but no alternate guardian if the first choice cannot act.',
        source: 'deterministic-rule',
      })
    }
  }

  if (data.insurance.hasPolicies && data.insurance.policies.length === 0) {
    issues.push({
      id: 'insurance-policy-details-missing',
      severity: 'mandatory',
      title: 'Insurance policy details missing',
      description: 'You indicated life insurance exists but have not added any policy details.',
      source: 'deterministic-rule',
    })
  }

  for (const policy of data.insurance.policies) {
    if ((policy.insurer || policy.policyNumber) && !policy.nomineeName.trim()) {
      issues.push({
        id: `policy-nominee-missing-${policy.id}`,
        severity: 'review',
        title: 'Insurance nominee not recorded',
        description: `${policy.insurer || 'A policy'} has no nominee information recorded.`,
        source: 'deterministic-rule',
      })
    }
  }

  const named = data.distribution.beneficiaries.filter((beneficiary) => beneficiary.name.trim())
  const withoutSubstitute = named.filter((beneficiary) => !beneficiary.substituteBeneficiary.trim())
  if (withoutSubstitute.length > 0) {
    issues.push({
      id: 'beneficiary-substitutes-missing',
      severity: 'context',
      title: 'Some beneficiaries have no substitute beneficiary',
      description: `${withoutSubstitute.length} beneficiary item(s) do not say who inherits if they predecease you.`,
      source: 'deterministic-rule',
    })
  }

  if (data.distribution.scheme === 'percentage' && named.length > 0) {
    const percents = named.map((beneficiary) => parsePercent(beneficiary.share))
    if (percents.some((percent) => percent === null)) {
      issues.push({
        id: 'percentage-share-missing',
        severity: 'review',
        title: 'Percentage scheme has beneficiaries without a percentage',
        description: 'The scheme is percentage-based, but at least one beneficiary has no percentage (for example "25%").',
        source: 'deterministic-rule',
      })
    } else {
      const total = percents.reduce<number>((sum, percent) => sum + (percent ?? 0), 0)
      if (Math.abs(total - 100) > 0.01) {
        issues.push({
          id: 'percentage-total-not-100',
          severity: 'review',
          title: `Beneficiary shares add up to ${Number.parseFloat(total.toFixed(2))}%, not 100%`,
          description: 'Shares under a percentage scheme should account for the whole residue of the estate.',
          source: 'deterministic-rule',
        })
      }
    }
  }

  const testatorAge = computeAge(data.personal.dateOfBirth)
  if (data.personal.dateOfBirth && testatorAge === null) {
    issues.push({
      id: 'invalid-date-of-birth',
      severity: 'mandatory',
      title: 'Date of birth looks invalid',
      description: 'The date of birth is in the future or could not be read.',
      source: 'deterministic-rule',
    })
  } else if (testatorAge !== null && testatorAge < 18) {
    issues.push({
      id: 'testator-under-18',
      severity: 'mandatory',
      title: 'Testator appears to be under 18',
      description: 'A minor cannot make a Will (Section 59, Indian Succession Act, 1925). Check the date of birth.',
      source: 'deterministic-rule',
    })
  }

  return issues
}

function contextualIssues(data: WillData): EstateIssue[] {
  const issues: EstateIssue[] = []
  const named = data.distribution.beneficiaries.filter((beneficiary) => beneficiary.name.trim())
  const children = (data.executorsGuardians.children ?? []).filter((child) => child.fullName.trim())

  if (data.executorsGuardians.hasChildren && children.length === 0) {
    issues.push({
      id: 'children-names-missing',
      severity: 'context',
      title: 'Your children are not named',
      description: 'You said you have children but have not listed them, so we cannot check that each child is provided for.',
      source: 'contextual-check',
    })
  }

  if (children.length > 0) {
    const unassigned = children.filter((child) => !named.some((beneficiary) => nameMatches(beneficiary.name, child.fullName)))
    if (unassigned.length > 0) {
      issues.push({
        id: 'children-not-beneficiaries',
        severity: 'review',
        title: `You listed ${children.length} ${children.length === 1 ? 'child' : 'children'} but ${
          children.length - unassigned.length === 0
            ? 'none is'
            : `only ${children.length - unassigned.length} ${children.length - unassigned.length === 1 ? 'is' : 'are'}`
        } named as a beneficiary`,
        description: `Not named as beneficiary: ${unassigned.map((child) => child.fullName).join(', ')}. This may be intentional, but it should be reviewed before finalizing the draft.`,
        source: 'contextual-check',
      })
    }
  } else if (data.executorsGuardians.hasChildren && named.length > 0 && !named.some((beneficiary) => beneficiary.relationship === 'child')) {
    issues.push({
      id: 'children-not-beneficiaries',
      severity: 'context',
      title: 'Children recorded but no child beneficiary listed',
      description: 'This may be intentional, but it should be reviewed before finalizing the draft.',
      source: 'contextual-check',
    })
  }

  if (data.assets.hasEncumberedAssets && data.distribution.scheme === 'itemized') {
    issues.push({
      id: 'itemized-distribution-with-encumbrance',
      severity: 'context',
      title: 'Itemized gifts may need debt handling',
      description: 'You have encumbered assets and itemized distribution instructions. Confirm who bears the linked liability.',
      source: 'contextual-check',
    })
  }

  if (data.distribution.scheme === 'itemized') {
    const unmapped = mapAssetsToBeneficiaries(data).filter(({ targets }) => targets.length === 0)
    if (unmapped.length > 0) {
      issues.push({
        id: 'assets-without-recipient',
        severity: 'review',
        title: `${unmapped.length} asset(s) have no recipient`,
        description: `No beneficiary is assigned to: ${unmapped.map(({ asset }) => asset.title).join(', ')}.`,
        source: 'contextual-check',
      })
    }
  }

  return issues
}

function contradictionIssues(data: WillData): EstateIssue[] {
  const issues: EstateIssue[] = []
  const scheme = data.distribution.scheme
  const named = data.distribution.beneficiaries.filter((beneficiary) => beneficiary.name.trim())

  if (scheme === 'all-in-one' && named.length > 1) {
    issues.push({
      id: 'all-in-one-multiple-beneficiaries',
      severity: 'review',
      title: 'Distribution scheme conflicts with beneficiary list',
      description: 'The scheme says all-in-one, but multiple beneficiaries are listed.',
      source: 'contradiction',
    })
  }

  // "Everything to my wife" together with "Noida property to my son" — a residue gift plus a specific gift
  // is fine, but an all-in-one scheme, or two people each claiming the whole, is not.
  if (scheme === 'all-in-one' && named.some((beneficiary) => beneficiary.assignedAssetIds?.length)) {
    issues.push({
      id: 'all-in-one-with-specific-assets',
      severity: 'review',
      title: 'All-in-one scheme, but specific assets are assigned',
      description: 'You chose to leave everything to one person, yet some assets are assigned to specific beneficiaries. Choose itemized, or remove the specific assignments.',
      source: 'contradiction',
    })
  }
  if (scheme === 'itemized' && named.some((beneficiary) => parsePercent(beneficiary.share) !== null)) {
    issues.push({
      id: 'itemized-with-percentages',
      severity: 'review',
      title: 'Itemized scheme mixes in percentage shares',
      description: 'Some beneficiaries have a percentage while the scheme is itemized. Clarify whether percentages apply to the residue.',
      source: 'contradiction',
    })
  }

  const assetOwners = new Map<string, string[]>()
  for (const beneficiary of named) {
    for (const assetId of beneficiary.assignedAssetIds ?? []) {
      assetOwners.set(assetId, [...(assetOwners.get(assetId) ?? []), beneficiary.name])
    }
  }
  for (const mapping of mapAssetsToBeneficiaries(data)) {
    const owners = assetOwners.get(mapping.asset.id) ?? []
    if (owners.length > 1) {
      issues.push({
        id: `asset-multiple-recipients-${mapping.asset.id}`,
        severity: 'review',
        title: 'One asset is assigned to more than one beneficiary',
        description: `${mapping.asset.title} is assigned to ${owners.join(' and ')}. Specify the shares or pick one recipient.`,
        source: 'contradiction',
      })
    }
  }

  const seen = new Map<string, number>()
  for (const beneficiary of named) {
    const key = beneficiary.name.trim().toLowerCase()
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  for (const [name, count] of seen) {
    if (count > 1) {
      issues.push({
        id: `duplicate-beneficiary-${name.replace(/\s+/g, '-')}`,
        severity: 'review',
        title: 'Beneficiary listed more than once',
        description: `"${name}" appears ${count} times in the beneficiary list. Merge the entries or clarify each share.`,
        source: 'contradiction',
      })
    }
  }

  // The "is this witness a beneficiary?" toggle must agree with the names actually entered.
  for (const witness of data.execution.witnesses) {
    if (!witness.fullName.trim()) continue
    const overlaps = named.some((beneficiary) => nameMatches(beneficiary.name, witness.fullName))
    if (overlaps && witness.isAlsoBeneficiary !== true) {
      issues.push({
        id: `witness-is-beneficiary-${witness.id}`,
        severity: 'review',
        title: 'A witness is also listed as a beneficiary',
        description: `${witness.fullName} is named as an attesting witness and as a beneficiary, but the witness question was not answered "Yes".`,
        source: 'contradiction',
      })
    }
  }

  if (data.personal.state.trim().toLowerCase() === 'uttarakhand' && data.execution.isUttarakhandExecution === false) {
    issues.push({
      id: 'uttarakhand-state-conflict',
      severity: 'review',
      title: 'Your state is Uttarakhand but you answered "No" to Uttarakhand execution',
      description: 'The question covers residing in OR executing the Will in Uttarakhand. Registration is compulsory there, so please re-check this answer.',
      source: 'contradiction',
    })
  }

  const confirmed = data.assistantIntake.extractions.filter((extraction) => extraction.status === 'confirmed')
  for (const extraction of confirmed) {
    if (
      extraction.intendedBeneficiary &&
      named.length > 0 &&
      !named.some((beneficiary) => beneficiary.name.toLowerCase().includes(extraction.intendedBeneficiary.toLowerCase()))
    ) {
      issues.push({
        id: `assistant-beneficiary-not-in-distribution-${extraction.id}`,
        severity: 'review',
        title: 'Confirmed assistant instruction is not reflected in beneficiaries',
        description: `"${extraction.originalStatement}" mentions ${extraction.intendedBeneficiary}, but that beneficiary is not currently listed.`,
        source: 'contradiction',
      })
    }
  }

  const children = (data.executorsGuardians.children ?? []).filter((child) => child.fullName.trim())
  const ages = children.map((child) => Number.parseInt(child.age, 10)).filter((age) => Number.isFinite(age))
  if (data.executorsGuardians.hasMinorChildren === true && ages.length > 0 && ages.every((age) => age >= 18)) {
    issues.push({
      id: 'minor-children-but-all-adults',
      severity: 'review',
      title: 'You said a child is a minor, but every listed child is 18 or older',
      description: 'Check the children\'s ages, or change the answer about minor children.',
      source: 'contradiction',
    })
  }
  if (data.executorsGuardians.hasMinorChildren === false && ages.some((age) => age < 18)) {
    issues.push({
      id: 'adult-children-but-minor-listed',
      severity: 'review',
      title: 'You said no child is a minor, but a listed child is under 18',
      description: 'Check the children\'s ages — a guardian may be needed.',
      source: 'contradiction',
    })
  }

  return issues
}

function nominationAlignmentIssues(data: WillData): EstateIssue[] {
  const issues: EstateIssue[] = []
  for (const row of buildNominationAlignment(data)) {
    if (row.status === 'mismatch') {
      issues.push({
        id: `nomination-beneficiary-mismatch-${row.assetId}`,
        severity: 'review',
        title: 'Nominee differs from intended beneficiary',
        description: `${row.nominee || 'The nominee'} is recorded for ${row.assetTitle}, but the intended beneficiary is ${row.intendedBeneficiaries.join(', ') || 'someone else'}. We flag the difference; a lawyer should advise on the consequence.`,
        source: 'nomination-alignment',
      })
    } else if (row.status === 'no-nominee' && row.kind !== 'insurance') {
      issues.push({
        id: `nominee-missing-${row.assetId}`,
        severity: 'context',
        title: 'No nominee recorded',
        description: `${row.assetTitle} has no nominee recorded.`,
        source: 'nomination-alignment',
      })
    }
  }
  return issues
}
