import { listAssets } from './assetMapping'
import { RELIGION_LABEL } from './labels'
import type { WillData } from './types'

function line(label: string, value: string) {
  return value ? `${label}: ${value}` : ''
}

function assignedAssetNames(data: WillData, ids: string[] | undefined) {
  if (!ids?.length) return ''
  const titles = new Map(listAssets(data).map((asset) => [asset.id, asset.title]))
  return ids.map((id) => titles.get(id)).filter(Boolean).join('; ')
}

export function formatAddress(p: WillData['personal']): string {
  return [p.addressLine, p.city, p.state, p.pincode].filter(Boolean).join(', ')
}

/**
 * Produces a plain-language draft for the testator's own review and for the
 * consulting lawyer's reference. This is NOT a certified legal instrument —
 * final wording must be reviewed and finalized by a qualified lawyer before
 * printing for wet-ink signature and witnessing (Indian Succession Act s.63).
 */
export function generateDraftText(data: WillData): string {
  const p = data.personal
  const sections: string[] = []

  sections.push(
    `LAST WILL AND TESTAMENT OF ${p.fullLegalName || '[Full Legal Name]'}\n(DRAFT — FOR REVIEW ONLY, NOT YET EXECUTED)`,
  )

  sections.push(
    [
      `I, ${p.fullLegalName || '[Full Legal Name]'}, born on ${p.dateOfBirth || '[Date of Birth]'}, residing at ${formatAddress(p) || '[Residential Address]'}, professing the ${(p.religion === 'other' && p.religionOther.trim()) || RELIGION_LABEL[p.religion] || '[Religion]'} faith, declare this to be my Last Will and Testament.`,
    ].join('\n'),
  )

  if (data.revocation.hasPriorWills) {
    sections.push(
      'REVOCATION\nI hereby revoke all prior Wills and Codicils made by me at any time before this Will.',
    )
  }

  sections.push(
    'DECLARATION\nI declare that I am of sound mind, memory, and understanding, and that I am making this Will voluntarily, of my own free will, without any coercion, fraud, or undue influence from any person.',
  )

  const primaryExecutors = data.executorsGuardians.executors.filter((e) => !e.isAlternate && e.fullName)
  const altExecutors = data.executorsGuardians.executors.filter((e) => e.isAlternate && e.fullName)
  if (primaryExecutors.length) {
    sections.push(
      [
        'APPOINTMENT OF EXECUTOR(S)',
        `I appoint ${primaryExecutors.map((e) => `${e.fullName} (${e.relationship || 'relationship unspecified'}, ${e.address || 'address unspecified'})`).join('; ')} as Executor(s) of this Will.`,
        altExecutors.length
          ? `Should the above Executor(s) be unable or unwilling to act, I appoint ${altExecutors.map((e) => e.fullName).join('; ')} as alternate Executor(s).`
          : '',
        data.executorsGuardians.compensation === 'compensated'
          ? 'The Executor(s) shall be entitled to reasonable compensation from the estate for their services.'
          : data.executorsGuardians.compensation === 'uncompensated'
            ? 'The Executor(s) shall serve without remuneration.'
            : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  if (data.executorsGuardians.hasChildren && data.executorsGuardians.hasMinorChildren) {
    const primaryGuardians = data.executorsGuardians.guardians.filter((g) => !g.isAlternate && g.fullName)
    const altGuardians = data.executorsGuardians.guardians.filter((g) => g.isAlternate && g.fullName)
    if (primaryGuardians.length) {
      sections.push(
        [
          'GUARDIANSHIP OF MINOR CHILDREN',
          `I appoint ${primaryGuardians.map((g) => g.fullName).join('; ')} as legal guardian(s) of my minor children.`,
          altGuardians.length
            ? `If unable or unwilling to serve, I appoint ${altGuardians.map((g) => g.fullName).join('; ')} as alternate guardian(s).`
            : '',
          ...primaryGuardians.filter((g) => g.financialInstructions).map((g) => `Financial instructions for ${g.fullName}: ${g.financialInstructions}`),
        ]
          .filter(Boolean)
          .join('\n'),
      )
    }
  }

  const assetLines = [
    ...data.assets.immovableAssets.map((a) =>
      line('Immovable property', [a.address, a.surveyNumber, a.registryDetails, a.ownershipShare].filter(Boolean).join(', ')),
    ),
    ...data.assets.bankAccounts.map((a) => line('Bank account', [a.bankName, a.branch, a.accountNumber && `A/C ${a.accountNumber}`].filter(Boolean).join(', '))),
    ...data.assets.investments.map((a) => line('Investment', [a.type, a.identifier, a.description && `(${a.description})`].filter(Boolean).join(' — '))),
    ...data.assets.valuables.map((v) => line('Valuable', `${v.description}${v.estimatedValue ? ` (est. ${v.estimatedValue})` : ''}`)),
  ].filter(Boolean)
  if (assetLines.length) {
    sections.push(['ESTATE INVENTORY', ...assetLines].join('\n'))
  }

  if (data.assets.hasEncumberedAssets) {
    const methodText =
      data.assets.debtSettlementMethod === 'specific-asset'
        ? 'from the specific encumbered asset itself'
        : data.assets.debtSettlementMethod === 'estate-reserves'
          ? 'from general estate cash reserves'
          : data.assets.debtSettlementMethod === 'before-distribution'
            ? 'prior to any distribution to beneficiaries'
            : '[method not yet specified]'
    sections.push(
      `ENCUMBRANCES\n${data.assets.encumbranceDetails || 'Certain estate assets are subject to mortgages, loans, or pledges.'} I direct that such liabilities be settled ${methodText}.`,
    )
  }

  if (data.distribution.beneficiaries.length) {
    const schemeLabel =
      data.distribution.scheme === 'all-in-one'
        ? 'I bequeath my entire estate as follows:'
        : data.distribution.scheme === 'itemized'
          ? 'I make the following specific bequests:'
          : 'I direct the residue of my estate be distributed as follows:'
    sections.push(
      [
        'DISTRIBUTION OF ESTATE',
        schemeLabel,
        ...data.distribution.beneficiaries.map(
          (b) =>
            `- To ${b.name} (${b.relationship || 'relationship unspecified'}): ${[assignedAssetNames(data, b.assignedAssetIds), b.share].filter(Boolean).join(' — ') || '[share unspecified]'}.` +
            (b.substituteBeneficiary ? ` If ${b.name} predeceases me or we die in circumstances rendering survivorship uncertain, this share shall instead pass to ${b.substituteBeneficiary}.` : ''),
        ),
        data.distribution.hasFutureAssets && data.distribution.futureAssetInstructions
          ? `Regarding assets I may inherit in the future: ${data.distribution.futureAssetInstructions}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )

    if (data.distribution.wantsSimultaneousDeathClause || data.distribution.residuaryBeneficiary) {
      sections.push(
        [
          'SURVIVORSHIP & RESIDUE',
          data.distribution.wantsSimultaneousDeathClause
            ? 'If any beneficiary under this Will and I die simultaneously, or in circumstances making the order of our deaths uncertain, that beneficiary shall be deemed to have predeceased me.'
            : '',
          data.distribution.residuaryBeneficiary
            ? `If any beneficiary and their named substitute both fail to survive me, or a gift otherwise lapses, the share concerned shall pass to ${data.distribution.residuaryBeneficiary} as my ultimate residuary beneficiary.`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
    }
  }

  if (data.insurance.policies.length) {
    sections.push(
      [
        'LIFE INSURANCE',
        ...data.insurance.policies.map(
          (i) =>
            `Policy ${i.policyNumber || '[number]'} with ${i.insurer || '[insurer]'}, nominee ${i.nomineeName || '[nominee]'} (${i.nomineeRelationship || 'relationship unspecified'}).` +
            (i.alignWithWill ? ' The nominee is confirmed as the ultimate intended beneficiary of these proceeds under this Will.' : ''),
        ),
      ].join('\n'),
    )
  }

  if (data.funeral.funeralWishes || data.funeral.payExpensesFromEstate) {
    sections.push(
      [
        'FUNERAL & ADMINISTRATION EXPENSES',
        data.funeral.funeralWishes || '',
        data.funeral.payExpensesFromEstate
          ? 'I direct my Executor(s) to pay all funeral costs, administrative expenses, and outstanding debts from my estate before distributing the remaining assets to beneficiaries.'
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  const namedWitnesses = data.execution.witnesses.filter((w) => w.fullName)
  sections.push(
    [
      'ATTESTATION',
      `Signed by the above-named testator as their Last Will and Testament in our joint presence, and then signed by us in the presence of the testator and of each other, as witnesses:`,
      ...namedWitnesses.map((w, i) => `Witness ${i + 1}: ${w.fullName}, ${w.address || '[address]'}`),
      '',
      '[ This draft must be printed and wet-ink signed by the testator in the simultaneous presence of both witnesses, who then also sign, per Section 63 of the Indian Succession Act, 1925. Electronic signing alone does not satisfy this requirement. ]',
    ]
      .filter(Boolean)
      .join('\n'),
  )

  return sections.join('\n\n')
}
