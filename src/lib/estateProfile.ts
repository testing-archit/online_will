import { computeAge } from './age'
import { classifyRelationship, listAssets, mapAssetsToBeneficiaries, nameMatches } from './assetMapping'
import { detectEstateIssues, estateIssuesToItems } from './estateIssues'
import { computeLegalFlags } from './legalRules'
import { getOverallCompletion, getSectionCompletion } from './questionnaireSchema'
import type { RelationshipType, VaultDocumentCategory, WillData } from './types'

export interface EstateProfileItem {
  id: string
  title: string
  subtitle?: string
  meta?: string
}

export interface EstateProfile {
  clientName: string
  familyMembers: EstateProfileItem[]
  beneficiaries: EstateProfileItem[]
  executors: EstateProfileItem[]
  guardians: EstateProfileItem[]
  assets: EstateProfileItem[]
  liabilities: EstateProfileItem[]
  insurance: EstateProfileItem[]
  distributionInstructions: EstateProfileItem[]
  documents: EstateProfileItem[]
  missingInformation: EstateProfileItem[]
  executionStatus: EstateProfileItem[]
  completion: {
    overall: number
    family: number
    assets: number
    beneficiaries: number
    nominations: number
    documents: number
    executors: number
    contingencies: number
    execution: number
  }
}

// ------------------------------------------------------------ family graph

export type FamilyGroup = 'spouse' | 'child' | 'parent' | 'other'

export interface FamilyPerson {
  key: string
  name: string
  group: FamilyGroup
  relationship: string
  age: string
  roles: string[]
  assets: string[]
}

export interface FamilyGraph {
  testator: FamilyPerson
  spouse: FamilyPerson[]
  children: FamilyPerson[]
  parents: FamilyPerson[]
  others: FamilyPerson[]
}

const GROUP_LABEL: Record<FamilyGroup, string> = { spouse: 'Spouse', child: 'Child', parent: 'Parent', other: 'Other' }

function personKey(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Everyone named anywhere in the Will, merged by name, with the roles they hold and the assets assigned to them. */
export function buildFamilyGraph(data: WillData): FamilyGraph {
  const people = new Map<string, FamilyPerson>()
  const testatorAge = computeAge(data.personal.dateOfBirth)

  const upsert = (name: string, group: FamilyGroup, relationship: string, age: string, role?: string) => {
    if (!name.trim()) return null
    const key = personKey(name)
    const existing = people.get(key)
    if (existing) {
      if (existing.group === 'other' && group !== 'other') existing.group = group
      if (!existing.relationship && relationship) existing.relationship = relationship
      if (!existing.age && age) existing.age = age
      if (role && !existing.roles.includes(role)) existing.roles.push(role)
      return existing
    }
    const person: FamilyPerson = { key, name: name.trim(), group, relationship, age, roles: role ? [role] : [], assets: [] }
    people.set(key, person)
    return person
  }

  for (const child of data.executorsGuardians.children ?? []) upsert(child.fullName, 'child', 'Child', child.age)

  const groupFor = (relationship: RelationshipType | '') => (relationship === '' ? 'other' : relationship)
  for (const beneficiary of data.distribution.beneficiaries) {
    upsert(beneficiary.name, groupFor(beneficiary.relationship), GROUP_LABEL[groupFor(beneficiary.relationship)], '', 'Beneficiary')
  }
  for (const executor of data.executorsGuardians.executors) {
    upsert(executor.fullName, classifyRelationship(executor.relationship), executor.relationship, executor.age, executor.isAlternate ? 'Alternate executor' : 'Primary executor')
  }
  if (data.executorsGuardians.hasChildren && data.executorsGuardians.hasMinorChildren) {
    for (const guardian of data.executorsGuardians.guardians) {
      upsert(guardian.fullName, classifyRelationship(guardian.relationship), guardian.relationship, guardian.age, guardian.isAlternate ? 'Alternate guardian' : 'Primary guardian')
    }
  }

  for (const { asset, targets } of mapAssetsToBeneficiaries(data)) {
    for (const target of targets) {
      const person = [...people.values()].find((candidate) => nameMatches(candidate.name, target.name))
      if (person && target.basis !== 'share' && !person.assets.includes(asset.title)) person.assets.push(asset.title)
    }
  }

  const all = [...people.values()]
  const byGroup = (group: FamilyGroup) => all.filter((person) => person.group === group)
  return {
    testator: {
      key: 'testator',
      name: data.personal.fullLegalName.trim() || 'Testator',
      group: 'other',
      relationship: 'Testator',
      age: testatorAge === null ? '' : String(testatorAge),
      roles: ['Testator'],
      assets: [],
    },
    spouse: byGroup('spouse'),
    children: byGroup('child'),
    parents: byGroup('parent'),
    others: byGroup('other'),
  }
}

function familyItems(graph: FamilyGraph): EstateProfileItem[] {
  const location = (person: FamilyPerson) =>
    [person.age && `Age ${person.age}`, person.roles.join(', ')].filter(Boolean).join(' · ')
  return [
    { id: 'testator', title: graph.testator.name, subtitle: 'Testator', meta: location(graph.testator) },
    ...[...graph.spouse, ...graph.children, ...graph.parents, ...graph.others].map((person) => ({
      id: `person-${person.key}`,
      title: person.name,
      subtitle: person.relationship || GROUP_LABEL[person.group],
      meta: [location(person), person.assets.length ? `Assigned: ${person.assets.join(', ')}` : ''].filter(Boolean).join(' · '),
    })),
  ]
}

// ----------------------------------------------------------------- profile

export function buildEstateProfile(data: WillData): EstateProfile {
  const flags = computeLegalFlags(data)
  const estateIssues = detectEstateIssues(data)
  const graph = buildFamilyGraph(data)
  const assetRefs = listAssets(data)

  return {
    clientName: data.personal.fullLegalName || 'Prospective testator',
    familyMembers: familyItems(graph),
    beneficiaries: data.distribution.beneficiaries
      .filter((beneficiary) => beneficiary.name.trim())
      .map((beneficiary) => ({
        id: beneficiary.id,
        title: beneficiary.name,
        subtitle: beneficiary.relationship || 'Relationship not specified',
        meta: beneficiary.substituteBeneficiary
          ? `Substitute: ${beneficiary.substituteBeneficiary}`
          : 'No substitute beneficiary recorded',
      })),
    executors: data.executorsGuardians.executors
      .filter((executor) => executor.fullName.trim())
      .map((executor) => ({
        id: executor.id,
        title: executor.fullName,
        subtitle: executor.isAlternate ? 'Alternate executor' : 'Primary executor',
        meta: [executor.relationship, executor.address].filter(Boolean).join(' · '),
      })),
    guardians:
      data.executorsGuardians.hasChildren && data.executorsGuardians.hasMinorChildren
        ? data.executorsGuardians.guardians
            .filter((guardian) => guardian.fullName.trim())
            .map((guardian) => ({
              id: guardian.id,
              title: guardian.fullName,
              subtitle: guardian.isAlternate ? 'Alternate guardian' : 'Primary guardian',
              meta: guardian.financialInstructions || guardian.relationship,
            }))
        : [],
    assets: assetRefs
      .filter((asset) => asset.kind !== 'insurance')
      .map((asset) => ({ id: asset.id, title: asset.title, subtitle: asset.subtitle, meta: asset.meta })),
    liabilities: data.assets.hasEncumberedAssets
      ? [
          {
            id: 'encumbrance',
            title: 'Mortgages, loans, or pledges',
            subtitle: data.assets.encumbranceDetails || 'Details not yet provided',
            meta: data.assets.debtSettlementMethod || 'Settlement method not selected',
          },
        ]
      : [],
    insurance: assetRefs
      .filter((asset) => asset.kind === 'insurance')
      .map((asset) => {
        const policy = data.insurance.policies.find((item) => item.id === asset.id)
        return {
          id: asset.id,
          title: policy?.insurer || 'Insurance policy',
          subtitle: policy?.policyNumber ? `Policy ${policy.policyNumber}` : 'Policy number not provided',
          meta: policy?.nomineeName
            ? `Nominee: ${policy.nomineeName}${policy.alignWithWill === false ? ' · alignment needs review' : ''}`
            : 'Nominee not recorded',
        }
      }),
    distributionInstructions: buildDistributionInstructions(data),
    documents: buildDocumentItems(data),
    missingInformation: [
      ...estateIssuesToItems(estateIssues),
      ...flags
        .filter((flag) => flag.severity !== 'info')
        .map((flag) => ({
          id: flag.id,
          title: flag.title,
          subtitle: flag.description,
          meta: flag.severity,
        })),
    ],
    executionStatus: [
      {
        id: 'witnesses',
        title: 'Attesting witnesses',
        subtitle: `${data.execution.witnesses.filter((witness) => witness.fullName.trim()).length} of 2 named`,
      },
      {
        id: 'video',
        title: 'Video recording',
        subtitle:
          data.execution.plansVideoRecording === null
            ? 'Not answered'
            : data.execution.plansVideoRecording
              ? 'Planned'
              : 'Not planned',
      },
      {
        id: 'registration',
        title: 'Registration',
        subtitle: data.execution.isUttarakhandExecution
          ? 'Mandatory registration path'
          : data.execution.isUttarakhandExecution === false
            ? 'Optional registration path'
            : 'Registration state not answered',
      },
      {
        id: 'checklist',
        title: 'Execution checklist',
        subtitle: `${data.estateOs.executionChecklist.filter((item) => item.completed).length} of ${data.estateOs.executionChecklist.length} steps complete`,
      },
    ],
    completion: {
      overall: getOverallCompletion(data),
      family: Math.round((getSectionCompletion(data, 'personal') + getSectionCompletion(data, 'executors')) / 2),
      assets: getSectionCompletion(data, 'assets'),
      beneficiaries: getSectionCompletion(data, 'distribution'),
      nominations: getSectionCompletion(data, 'insurance'),
      documents: documentChecklistCompletion(data),
      executors: getSectionCompletion(data, 'executors'),
      contingencies: contingencyCompletion(data),
      execution: getSectionCompletion(data, 'execution'),
    },
  }
}

function buildDistributionInstructions(data: WillData): EstateProfileItem[] {
  const assetTitles = new Map(listAssets(data).map((asset) => [asset.id, asset.title]))
  const instructions = data.distribution.beneficiaries
    .filter((beneficiary) => beneficiary.name.trim() || beneficiary.share.trim() || beneficiary.assignedAssetIds?.length)
    .map((beneficiary) => {
      const assigned = (beneficiary.assignedAssetIds ?? []).map((id) => assetTitles.get(id)).filter(Boolean)
      return {
        id: beneficiary.id,
        title: beneficiary.name || 'Unnamed beneficiary',
        subtitle: [assigned.join(', '), beneficiary.share].filter(Boolean).join(' · ') || 'Share / asset not specified',
        meta: beneficiary.substituteBeneficiary
          ? `If predeceased: ${beneficiary.substituteBeneficiary}`
          : 'No substitute beneficiary',
      }
    })

  if (data.distribution.residuaryBeneficiary.trim()) {
    instructions.push({
      id: 'residuary',
      title: data.distribution.residuaryBeneficiary,
      subtitle: 'Ultimate residuary beneficiary',
      meta: 'Fallback if all named beneficiaries fail',
    })
  }

  return instructions
}

// --------------------------------------------------------------- documents

interface ChecklistEntry {
  id: string
  title: string
  subtitle: string
  categories: VaultDocumentCategory[]
}

function buildDocumentChecklist(data: WillData): ChecklistEntry[] {
  const entries: ChecklistEntry[] = [
    { id: 'identity', title: 'Identity proof', subtitle: 'PAN / Aadhaar / passport', categories: ['pan', 'id'] },
  ]
  if (data.assets.immovableAssets.length > 0) {
    entries.push({ id: 'property', title: 'Property documents', subtitle: 'Sale deed / registry / tax records', categories: ['property'] })
  }
  if (data.assets.bankAccounts.length > 0 || data.assets.investments.length > 0) {
    entries.push({ id: 'financial', title: 'Financial statements', subtitle: 'Bank, demat, CAS, or portfolio records', categories: ['bank', 'cas', 'demat'] })
  }
  if (data.insurance.hasPolicies) {
    entries.push({ id: 'insurance', title: 'Insurance policy documents', subtitle: 'Policy schedule and nomination records', categories: ['insurance'] })
  }
  if (data.assets.hasEncumberedAssets) {
    entries.push({ id: 'loan', title: 'Loan / mortgage documents', subtitle: 'Sanction letter and current outstanding statement', categories: ['loan'] })
  }
  if (data.revocation.hasPriorWills) {
    entries.push({ id: 'prior-will', title: 'Prior Will / Codicil', subtitle: 'Required for revocation review', categories: ['existing-will'] })
  }
  return entries
}

function coverage(entry: ChecklistEntry, data: WillData): 'confirmed' | 'uploaded' | 'missing' {
  const matches = data.documentVault.documents.filter((document) => entry.categories.includes(document.category))
  if (matches.some((document) => document.status === 'confirmed')) return 'confirmed'
  return matches.length > 0 ? 'uploaded' : 'missing'
}

function buildDocumentItems(data: WillData): EstateProfileItem[] {
  const uploaded = data.documentVault.documents.map((document) => ({
    id: document.id,
    title: document.fileName,
    subtitle: document.category,
    meta: `${document.status.replace('_', ' ')} · ${Math.round(document.confidence * 100)}% confidence`,
  }))
  const requested = buildDocumentChecklist(data)
    .filter((entry) => coverage(entry, data) === 'missing')
    .map((entry) => ({ id: `requested-${entry.id}`, title: entry.title, subtitle: entry.subtitle, meta: 'Requested — not yet uploaded' }))
  return [...uploaded, ...requested]
}

function documentChecklistCompletion(data: WillData) {
  const checklist = buildDocumentChecklist(data)
  if (!checklist.length) return 100
  const score = checklist.reduce((sum, entry) => {
    const state = coverage(entry, data)
    return sum + (state === 'confirmed' ? 1 : state === 'uploaded' ? 0.5 : 0)
  }, 0)
  return Math.round((score / checklist.length) * 100)
}

function contingencyCompletion(data: WillData) {
  const named = data.distribution.beneficiaries.filter((beneficiary) => beneficiary.name.trim())
  const checks = [
    data.distribution.wantsSimultaneousDeathClause !== null,
    Boolean(data.distribution.residuaryBeneficiary.trim()),
    // With no beneficiaries there is nothing to be covered — that must not count as "every beneficiary has a substitute".
    named.length > 0 && named.every((beneficiary) => beneficiary.substituteBeneficiary.trim()),
    data.executorsGuardians.executors.some((executor) => executor.isAlternate && executor.fullName.trim()),
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}
