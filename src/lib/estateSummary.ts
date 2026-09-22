import { listAssets, mapAssetsToBeneficiaries, type AssetKind } from './assetMapping'
import { buildFamilyGraph } from './estateProfile'
import { formatInr } from './money'
import type { WillData } from './types'

export interface EstateSummary {
  estimatedValue: number | null
  valueNote: string
  family: string[]
  assets: string[]
  primaryBeneficiary: string
  specificBequests: string[]
  text: string
}

const PLURAL: Record<AssetKind, [string, string]> = {
  immovable: ['property', 'properties'],
  bank: ['bank account / deposit', 'bank accounts / deposits'],
  investment: ['investment', 'investments'],
  valuable: ['valuable', 'valuables'],
  insurance: ['insurance policy', 'insurance policies'],
}

/**
 * Task 9 — a plain-language overview generated from recorded information only.
 * It summarises what the user entered; it does not infer legal conclusions or
 * fill gaps with assumptions.
 */
export function buildEstateSummary(data: WillData): EstateSummary {
  const graph = buildFamilyGraph(data)
  const assets = listAssets(data)
  const mappings = mapAssetsToBeneficiaries(data)

  const valued = assets.filter((asset) => asset.value !== null)
  const estimatedValue = valued.length ? valued.reduce((sum, asset) => sum + (asset.value ?? 0), 0) : null
  const valueNote = assets.length
    ? valued.length === assets.length
      ? 'Based on the values you recorded for every asset.'
      : `Based on the ${valued.length} of ${assets.length} asset(s) with a recorded value; the rest are excluded.`
    : 'No assets recorded yet.'

  const family: string[] = []
  if (graph.spouse.length) family.push(graph.spouse.length > 1 ? `${graph.spouse.length} spouses/partners recorded` : 'Spouse')
  if (graph.children.length) family.push(`${graph.children.length} ${graph.children.length === 1 ? 'child' : 'children'}`)
  else if (data.executorsGuardians.hasChildren) family.push('Children (names not recorded)')
  if (graph.parents.length) family.push(graph.parents.length > 1 ? 'Parents' : 'Parent')
  if (graph.others.length) family.push(`${graph.others.length} other named ${graph.others.length === 1 ? 'person' : 'people'}`)

  const counts = new Map<AssetKind, number>()
  for (const asset of assets) counts.set(asset.kind, (counts.get(asset.kind) ?? 0) + 1)
  const assetLines = [...counts.entries()].map(([kind, count]) => `${count} ${PLURAL[kind][count === 1 ? 0 : 1]}`)

  const named = data.distribution.beneficiaries.filter((beneficiary) => beneficiary.name.trim())
  const primary =
    data.distribution.scheme === 'all-in-one'
      ? named[0]
      : named.find((beneficiary) => /\b(residue|rest|remaining|everything|balance)\b/i.test(beneficiary.share)) ?? named.find((beneficiary) => beneficiary.relationship === 'spouse')
  const primaryBeneficiary = primary
    ? `${primary.name}${primary.relationship ? ` (${primary.relationship})` : ''}`
    : data.distribution.residuaryBeneficiary.trim() || 'Not yet recorded'

  const specificBequests = mappings
    .filter(({ targets }) => targets.some((target) => target.basis === 'assigned' || target.basis === 'described'))
    .map(({ asset, targets }) => `${asset.title} → ${targets.filter((target) => target.basis === 'assigned' || target.basis === 'described').map((target) => target.name).join(', ')}`)

  const lines = [
    'Estate Overview',
    '',
    estimatedValue === null ? 'Estimated estate value: not enough values recorded' : `Estimated estate value: ${formatInr(estimatedValue)}`,
    `(${valueNote})`,
    '',
    'Family:',
    ...(family.length ? family.map((line) => `• ${line}`) : ['• No family members recorded yet']),
    '',
    'Assets:',
    ...(assetLines.length ? assetLines.map((line) => `• ${line}`) : ['• None recorded yet']),
    '',
    'Primary beneficiary:',
    primaryBeneficiary,
    '',
    'Specific bequests:',
    ...(specificBequests.length ? specificBequests : ['None recorded']),
    '',
    'This summary restates information you provided. It is not legal advice or a legal opinion.',
  ]

  return {
    estimatedValue,
    valueNote,
    family,
    assets: assetLines,
    primaryBeneficiary,
    specificBequests,
    text: lines.join('\n'),
  }
}

