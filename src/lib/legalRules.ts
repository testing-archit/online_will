import { computeAge } from './age'
import { nameMatches } from './assetMapping'
import { jurisdictionFlags } from './jurisdictionRules'
import type { LegalFlag, WillData } from './types'

const NON_HEIR_RELATIONSHIPS = new Set(['other'])
const WITNESS_VOIDING_RELIGIONS = new Set(['christian', 'parsi'])

function parsePercent(share: string): number | null {
  const match = share.match(/(\d+(\.\d+)?)\s*%/)
  if (!match) return null
  const value = Number.parseFloat(match[1])
  return Number.isNaN(value) ? null : value
}

export function computeLegalFlags(data: WillData): LegalFlag[] {
  const flags: LegalFlag[] = []
  const push = (flag: Omit<LegalFlag, 'id'> & { id: string }) => flags.push(flag)

  // --- Testamentary capacity: age ---
  const testatorAge = computeAge(data.personal.dateOfBirth)
  if (data.personal.dateOfBirth && (testatorAge === null || testatorAge < 18)) {
    push({
      id: 'testator-not-adult',
      severity: 'critical',
      title: 'Testator must be at least 18',
      description:
        'Section 59 of the Indian Succession Act, 1925 allows only a person of sound mind who is not a minor to make a Will. The date of birth entered is in the future or makes the testator under 18.',
      sourceStepId: 'personal',
    })
  }

  // --- Personal / religion-driven testamentary capacity ---
  if (data.personal.religion === 'muslim') {
    const nonHeirBeneficiaries = data.distribution.beneficiaries.filter((b) =>
      NON_HEIR_RELATIONSHIPS.has(b.relationship),
    )
    const nonHeirPercentTotal = nonHeirBeneficiaries.reduce((sum, b) => {
      const pct = parsePercent(b.share)
      return sum + (pct ?? 0)
    }, 0)
    const anyUnparsed = nonHeirBeneficiaries.some((b) => parsePercent(b.share) === null)

    if (nonHeirBeneficiaries.length > 0 && (nonHeirPercentTotal > 33.33 || anyUnparsed)) {
      push({
        id: 'shariat-one-third',
        severity: 'critical',
        title: 'Bequest to non-heirs may exceed the Shariat 1/3rd limit',
        description:
          'Under Islamic personal law (Shariat), a Muslim testator can generally bequeath at most one-third of the net estate to non-heirs without the consent of all other legal heirs. Review the shares assigned to non-heir beneficiaries with a qualified lawyer before finalizing.',
        sourceStepId: 'distribution',
      })
    } else if (data.distribution.beneficiaries.length > 0) {
      push({
        id: 'shariat-note',
        severity: 'info',
        title: 'Islamic personal law governs this will',
        description:
          'As a Muslim testator, distribution of your estate is governed by Shariat principles rather than the Indian Succession Act, 1925. A lawyer familiar with Muslim personal law should review the final draft.',
        sourceStepId: 'personal',
      })
    }
  }

  // --- Revocation ---
  if (data.revocation.hasPriorWills && !data.revocation.revokesAllPrior) {
    push({
      id: 'missing-revocation-clause',
      severity: 'critical',
      title: 'Revocation clause required',
      description:
        'You indicated a prior Will or Codicil exists. Indian law requires this new Will to explicitly revoke all earlier Wills and Codicils, or the two documents may be read together and create conflicting bequests.',
      sourceStepId: 'revocation',
    })
  }

  if (!data.revocation.soundMindDeclaration) {
    push({
      id: 'missing-sound-mind',
      severity: 'critical',
      title: 'Sound-mind declaration not confirmed',
      description:
        'A valid Will requires the testator to declare they are of sound mind and acting voluntarily. This declaration is missing.',
      sourceStepId: 'revocation',
    })
  }

  if (data.revocation.hasMedicalCertificate === false) {
    push({
      id: 'no-medical-certificate',
      severity: 'info',
      title: 'Consider a medical fitness certificate',
      description:
        'A medical certificate confirming mental fitness at the time of execution is not mandatory, but it materially strengthens the Will against future claims of incapacity — especially for older testators or contested estates.',
      sourceStepId: 'revocation',
    })
  }

  // --- Executors & guardians ---
  const primaryExecutors = data.executorsGuardians.executors.filter((e) => !e.isAlternate)
  if (primaryExecutors.length === 0 || primaryExecutors.every((e) => !e.fullName.trim())) {
    push({
      id: 'no-primary-executor',
      severity: 'critical',
      title: 'No primary executor named',
      description: 'At least one primary executor must be appointed to administer the estate.',
      sourceStepId: 'executors',
    })
  }

  if (data.executorsGuardians.hasChildren && data.executorsGuardians.hasMinorChildren) {
    const primaryGuardians = data.executorsGuardians.guardians.filter(
      (g) => !g.isAlternate && g.fullName.trim(),
    )
    if (primaryGuardians.length === 0) {
      push({
        id: 'no-primary-guardian',
        severity: 'critical',
        title: 'Minor children need a nominated guardian',
        description:
          'You indicated you have minor children but no primary guardian has been named. Without this, a court will decide guardianship after your passing.',
        sourceStepId: 'executors',
      })
    }
  }

  // --- Assets & liabilities ---
  if (data.assets.hasEncumberedAssets && !data.assets.debtSettlementMethod) {
    push({
      id: 'unspecified-debt-settlement',
      severity: 'warning',
      title: 'Debt settlement method not specified',
      description:
        'You noted encumbered assets (mortgages/loans/pledges) but have not specified how those liabilities should be settled. Leaving this open can delay distribution and create disputes among beneficiaries.',
      sourceStepId: 'assets',
    })
  }

  // --- Insurance nominations ---
  for (const policy of data.insurance.policies) {
    if (!policy.nomineeRelationship) continue
    if (['spouse', 'parent', 'child'].includes(policy.nomineeRelationship) && policy.alignWithWill === false) {
      push({
        id: `insurance-beneficial-owner-${policy.id}`,
        severity: 'warning',
        title: `Nominee "${policy.nomineeName || 'unnamed'}" is a beneficial owner by default`,
        description:
          'Under Section 39 of the Insurance Act, a spouse/parent/child nominee is treated as the beneficial owner of policy proceeds by default, regardless of what the Will says. Since you indicated this nominee is not the intended ultimate beneficiary, this policy needs explicit legal handling (e.g., a nomination change or a trust structure) — the Will alone may not override it.',
        sourceStepId: 'insurance',
      })
    }
    if (policy.nomineeRelationship === 'other') {
      push({
        id: `insurance-trustee-nominee-${policy.id}`,
        severity: 'info',
        title: `Nominee "${policy.nomineeName || 'unnamed'}" acts only as a collector, not owner`,
        description:
          'A nominee who is not a spouse, parent, or child (e.g., a sibling or friend) generally holds policy proceeds only as a trustee for the legal heirs. Confirm the Will clearly states who the ultimate intended beneficiary of these proceeds is.',
        sourceStepId: 'insurance',
      })
    }
  }

  // --- Distribution scheme ---
  if (data.distribution.scheme && data.distribution.beneficiaries.length === 0) {
    push({
      id: 'no-beneficiaries',
      severity: 'critical',
      title: 'No beneficiaries listed',
      description: 'A distribution scheme is selected but no beneficiaries have been added yet.',
      sourceStepId: 'distribution',
    })
  }

  // --- Survivorship & contingency ---
  if (data.distribution.beneficiaries.length > 0 && !data.distribution.residuaryBeneficiary.trim()) {
    push({
      id: 'no-residuary-beneficiary',
      severity: 'warning',
      title: 'No ultimate residuary beneficiary named',
      description:
        'If every beneficiary and substitute you named predeceases you, this Will does not say who should inherit instead — your estate could fall back into intestate succession despite having a Will. Consider naming a final fallback beneficiary (a relative, or a charitable institution).',
      sourceStepId: 'distribution',
    })
  }

  if (data.distribution.beneficiaries.length > 0 && data.distribution.wantsSimultaneousDeathClause === false) {
    push({
      id: 'no-simultaneous-death-clause',
      severity: 'info',
      title: 'No simultaneous-death clause included',
      description:
        'Without this clause, Section 105 of the Indian Succession Act applies a default presumption in cases of uncertain survivorship (the younger person is presumed to have survived the elder) — which may not reflect your actual wishes if you and a beneficiary were to die together.',
      sourceStepId: 'distribution',
    })
  }

  // --- Execution & attestation ---
  const namedWitnesses = data.execution.witnesses.filter((w) => w.fullName.trim())
  if (namedWitnesses.length < 2) {
    push({
      id: 'witness-count',
      severity: 'critical',
      title: 'At least two attesting witnesses are required',
      description:
        'Section 63 of the Indian Succession Act, 1925 requires the Will to be attested by two or more witnesses who each see the testator sign (or acknowledge their signature) and then sign themselves in the testator\'s presence.',
      sourceStepId: 'execution',
    })
  }

  // A witness counts as a beneficiary if the user says so OR the same name appears in the beneficiary list.
  const namedBeneficiaries = data.distribution.beneficiaries.filter((b) => b.name.trim())
  const witnessIsBeneficiary = data.execution.witnesses.some(
    (w) => w.isAlsoBeneficiary || (w.fullName.trim() && namedBeneficiaries.some((b) => nameMatches(b.name, w.fullName))),
  )

  if (data.personal.religion && WITNESS_VOIDING_RELIGIONS.has(data.personal.religion) && witnessIsBeneficiary) {
    push({
      id: 'witness-beneficiary-void',
      severity: 'critical',
      title: 'A witness who is also a beneficiary may void their own bequest',
      description:
        'For Christian and Parsi testators, Section 67 of the Indian Succession Act voids any bequest made to a person who acts as an attesting witness (or their spouse). Replace this witness with someone who receives nothing under the Will, or the affected bequest may fail.',
      sourceStepId: 'execution',
    })
  } else if (
    data.personal.religion &&
    !WITNESS_VOIDING_RELIGIONS.has(data.personal.religion) &&
    data.personal.religion !== 'other' &&
    data.execution.witnesses.some((w) => w.isAlsoBeneficiary)
  ) {
    push({
      id: 'witness-beneficiary-allowed',
      severity: 'info',
      title: 'Beneficiary witness is permitted for your personal law',
      description:
        'Under the Indian Succession Act, a beneficiary can generally act as an attesting witness without invalidating their own bequest for Hindu, Buddhist, Jain, and Sikh testators. It is still good practice to use independent witnesses where possible.',
      sourceStepId: 'execution',
    })
  }

  // --- Jurisdiction rules engine (Task 37) ---
  // Registration/execution requirements now resolve through the versioned
  // jurisdiction rules engine rather than hardcoded branches, so state-level
  // legal changes ship as data updates with an effectiveFrom date.
  for (const flag of jurisdictionFlags(data)) {
    push(flag)
  }

  if (data.execution.plansVideoRecording === false) {
    push({
      id: 'video-recording-suggestion',
      severity: 'info',
      title: 'Consider recording the signing',
      description:
        'Videotaping the execution and reading-aloud of the Will is not legally required but can help rebut future claims of incapacity or undue influence.',
      sourceStepId: 'execution',
    })
  }

  const severityOrder: Record<LegalFlag['severity'], number> = { critical: 0, warning: 1, info: 2 }
  return flags.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
}

export function flagCounts(flags: LegalFlag[]) {
  return {
    critical: flags.filter((f) => f.severity === 'critical').length,
    warning: flags.filter((f) => f.severity === 'warning').length,
    info: flags.filter((f) => f.severity === 'info').length,
  }
}
