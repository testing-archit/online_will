import { parseInr } from './money'
import type { RelationshipType, WillData } from './types'

export type AssetKind = 'immovable' | 'bank' | 'investment' | 'valuable' | 'insurance'

export interface AssetRef {
  id: string
  kind: AssetKind
  title: string
  subtitle: string
  meta: string
  /** Rupee value if the user recorded one that can be parsed. */
  value: number | null
  nominee: string
}

const KIND_LABEL: Record<AssetKind, string> = {
  immovable: 'Immovable property',
  bank: 'Bank / fixed deposit',
  investment: 'Investment',
  valuable: 'Valuable',
  insurance: 'Life insurance',
}

export function assetKindLabel(kind: AssetKind) {
  return KIND_LABEL[kind]
}

/** Every recorded asset as a uniform reference, with stable ids from the questionnaire. */
export function listAssets(data: WillData): AssetRef[] {
  const assets: AssetRef[] = []

  for (const asset of data.assets.immovableAssets) {
    if (!asset.address.trim()) continue
    assets.push({
      id: asset.id,
      kind: 'immovable',
      title: asset.address,
      subtitle: KIND_LABEL.immovable,
      meta: [asset.ownershipShare && `Your share ${asset.ownershipShare}`, asset.registryDetails].filter(Boolean).join(' · '),
      value: parseInr(asset.estimatedValue),
      nominee: '',
    })
  }
  for (const account of data.assets.bankAccounts) {
    if (!account.bankName.trim() && !account.accountNumber.trim()) continue
    assets.push({
      id: account.id,
      kind: 'bank',
      title: account.bankName || 'Bank account',
      subtitle: account.branch || KIND_LABEL.bank,
      meta: maskIdentifier(account.accountNumber),
      value: parseInr(account.estimatedValue),
      nominee: account.nomineeName?.trim() ?? '',
    })
  }
  for (const investment of data.assets.investments) {
    if (!investment.type.trim() && !investment.description.trim()) continue
    assets.push({
      id: investment.id,
      kind: 'investment',
      title: investment.description || investment.type,
      subtitle: investment.type || KIND_LABEL.investment,
      meta: investment.identifier,
      value: parseInr(investment.estimatedValue),
      nominee: investment.nomineeName?.trim() ?? '',
    })
  }
  for (const valuable of data.assets.valuables) {
    if (!valuable.description.trim()) continue
    assets.push({
      id: valuable.id,
      kind: 'valuable',
      title: valuable.description,
      subtitle: KIND_LABEL.valuable,
      meta: valuable.estimatedValue,
      value: parseInr(valuable.estimatedValue),
      nominee: '',
    })
  }
  for (const policy of data.insurance.policies) {
    if (!policy.insurer.trim() && !policy.policyNumber.trim()) continue
    assets.push({
      id: policy.id,
      kind: 'insurance',
      title: `${policy.insurer || 'Insurance policy'}${policy.policyNumber ? ` — ${maskIdentifier(policy.policyNumber)}` : ''}`,
      subtitle: KIND_LABEL.insurance,
      meta: policy.nomineeName ? `Nominee: ${policy.nomineeName}` : 'Nominee not recorded',
      value: null,
      nominee: policy.nomineeName.trim(),
    })
  }
  return assets
}

export function maskIdentifier(value: string) {
  const clean = value.trim()
  return clean.length > 4 ? `••••${clean.slice(-4)}` : clean
}

// ---------------------------------------------------------------- mapping

export type MappingBasis = 'assigned' | 'described' | 'share' | 'residue'

export interface MappingTarget {
  beneficiaryId: string
  name: string
  basis: MappingBasis
  /** Human-readable reason, e.g. "25%" or "Assigned in Distribution". */
  detail: string
}

export interface AssetMapping {
  asset: AssetRef
  targets: MappingTarget[]
}

const GENERIC_WORDS = new Set([
  'the', 'and', 'all', 'property', 'house', 'flat', 'plot', 'apartment', 'villa', 'land', 'account', 'accounts',
  'bank', 'fund', 'funds', 'mutual', 'policy', 'insurance', 'road', 'street', 'nagar', 'sector', 'floor', 'near',
  'residue', 'specific', 'bequest', 'share', 'estate', 'assets', 'asset', 'road', 'city', 'india', 'ltd', 'limited',
])

function distinctiveWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !GENERIC_WORDS.has(word))
}

const KIND_WORDS: Record<AssetKind, RegExp> = {
  immovable: /\b(property|house|flat|plot|apartment|villa|land|home)\b/i,
  bank: /\b(bank|fd|fixed deposit|deposit|savings|account)\b/i,
  investment: /\b(mutual fund|mf|portfolio|shares?|stocks?|demat|investments?|ppf|nps|epf)\b/i,
  valuable: /\b(jewell?ery|gold|car|vehicle|art|watch|valuables?)\b/i,
  insurance: /\b(insurance|policy|policies)\b/i,
}

/**
 * Who receives each asset, based only on what the user recorded:
 *  1. explicit assignment in the Distribution step,
 *  2. a description that names the asset (e.g. "Noida property"),
 *  3. otherwise the beneficiary shares (percentage / all-in-one), or the residuary beneficiary.
 * Anything else is left unmapped rather than guessed.
 */
export function mapAssetsToBeneficiaries(data: WillData): AssetMapping[] {
  const assets = listAssets(data)
  const named = data.distribution.beneficiaries.filter((beneficiary) => beneficiary.name.trim())
  const scheme = data.distribution.scheme
  const residuary = data.distribution.residuaryBeneficiary.trim()

  return assets.map((asset) => {
    const targets: MappingTarget[] = []

    for (const beneficiary of named) {
      if (beneficiary.assignedAssetIds?.includes(asset.id)) {
        targets.push({ beneficiaryId: beneficiary.id, name: beneficiary.name, basis: 'assigned', detail: 'Assigned in Distribution' })
      }
    }

    if (targets.length === 0) {
      const assetWords = distinctiveWords(`${asset.title} ${asset.subtitle}`)
      for (const beneficiary of named) {
        const description = beneficiary.share
        if (!description || /^\s*\d+(\.\d+)?\s*%/.test(description) || /^residue$/i.test(description.trim())) continue
        const wordMatch = distinctiveWords(description).some((word) => assetWords.some((assetWord) => assetWord === word))
        // A generic mention ("the property") only counts when there is a single asset of that kind.
        const singleOfKind = assets.filter((candidate) => candidate.kind === asset.kind).length === 1
        const kindMatch = singleOfKind && KIND_WORDS[asset.kind].test(description) && distinctiveWords(description).length === 0
        if (wordMatch || kindMatch) {
          targets.push({ beneficiaryId: beneficiary.id, name: beneficiary.name, basis: 'described', detail: description })
        }
      }
    }

    if (targets.length === 0 && named.length > 0) {
      if (scheme === 'all-in-one') {
        const primary = named[0]
        targets.push({ beneficiaryId: primary.id, name: primary.name, basis: 'share', detail: 'Entire estate' })
      } else if (scheme === 'percentage') {
        for (const beneficiary of named) {
          targets.push({ beneficiaryId: beneficiary.id, name: beneficiary.name, basis: 'share', detail: beneficiary.share || 'share not specified' })
        }
      } else {
        // Someone explicitly described as taking "the rest" receives whatever was not gifted specifically.
        const residueHolders = named.filter((beneficiary) => /\b(residue|rest|remaining|everything|balance)\b/i.test(beneficiary.share))
        for (const beneficiary of residueHolders) {
          targets.push({ beneficiaryId: beneficiary.id, name: beneficiary.name, basis: 'residue', detail: 'Residue of the estate' })
        }
        if (residueHolders.length === 0 && residuary) {
          targets.push({ beneficiaryId: 'residuary', name: residuary, basis: 'residue', detail: 'Residuary beneficiary' })
        }
      }
    }

    return { asset, targets }
  })
}

// ------------------------------------------------------ nomination alignment

export type AlignmentStatus = 'aligned' | 'mismatch' | 'no-nominee' | 'no-intended-beneficiary'

export interface NominationAlignment {
  assetId: string
  assetTitle: string
  kind: AssetKind
  nominee: string
  intendedBeneficiaries: string[]
  status: AlignmentStatus
}

function sameName(a: string, b: string) {
  const left = a.trim().toLowerCase()
  const right = b.trim().toLowerCase()
  return Boolean(left) && Boolean(right) && (left === right || left.includes(right) || right.includes(left))
}

/**
 * Compares each nominee with the intended beneficiary. This flags the
 * difference for human review; it does not declare the legal consequence.
 */
export function buildNominationAlignment(data: WillData): NominationAlignment[] {
  const mappings = mapAssetsToBeneficiaries(data)
  return mappings
    .filter(({ asset }) => asset.kind === 'insurance' || asset.kind === 'bank' || asset.kind === 'investment')
    .map(({ asset, targets }) => {
      const policy = data.insurance.policies.find((item) => item.id === asset.id)
      // For insurance the user can state alignment directly.
      const explicitAlign = policy?.alignWithWill
      const intended = explicitAlign === true && asset.nominee ? [asset.nominee] : targets.map((target) => target.name)

      let status: AlignmentStatus
      if (!asset.nominee) status = 'no-nominee'
      else if (explicitAlign === false) status = 'mismatch'
      else if (intended.length === 0) status = 'no-intended-beneficiary'
      else status = intended.some((name) => sameName(name, asset.nominee)) ? 'aligned' : 'mismatch'

      return {
        assetId: asset.id,
        assetTitle: asset.title,
        kind: asset.kind,
        nominee: asset.nominee,
        intendedBeneficiaries: intended,
        status,
      }
    })
}

// ----------------------------------------------------------- relationships

export function classifyRelationship(text: string): RelationshipType {
  const value = text.toLowerCase()
  if (/\b(wife|husband|spouse|partner|patni|biwi|pati)\b/.test(value)) return 'spouse'
  if (/\b(son|daughter|child|kid|beta|beti)\b/.test(value)) return 'child'
  if (/\b(mother|father|parent|mom|dad|maa|papa)\b/.test(value)) return 'parent'
  return 'other'
}

export function nameMatches(a: string, b: string) {
  return sameName(a, b)
}

