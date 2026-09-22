import { newId } from './id'
import { classifyRelationship } from './assetMapping'
import type { DetectedLanguage } from './language'
import type { Beneficiary, ImmovableAsset, InterviewTurnProposal, RelationshipType, WillData } from './types'

// English plus common Hindi/Hinglish kinship and asset words, so the offline fallback
// still understands "meri beti ko Noida wala ghar dena hai".
const RELATIONSHIP_PATTERNS = [
  { relationship: 'spouse' as const, name: 'Wife', pattern: /\b(wife|spouse|patni|biwi)\b|पत्नी|बीवी|घरवाली/i },
  { relationship: 'spouse' as const, name: 'Husband', pattern: /\b(husband|pati)\b|पति|शौहर/i },
  { relationship: 'child' as const, name: 'Daughter', pattern: /\b(daughter|beti|ladki)\b|बेटी|लड़की|पुत्री/i },
  { relationship: 'child' as const, name: 'Son', pattern: /\b(son|beta|ladka)\b|बेटा|लड़का|पुत्र/i },
  { relationship: 'parent' as const, name: 'Parent', pattern: /\b(parents?|mother|father|maa|mummy|papa|pita)\b|माता|पिता|माँ|मां|पापा|मम्मी/i },
]

const PROPERTY_WORDS = /\b(property|house|flat|plot|apartment|villa|ghar|makaan|makan|zameen|jameen|kothi)\b|मकान|घर|फ्लैट|प्लॉट|ज़मीन|जमीन|कोठी|प्रॉपर्टी|प्रोपर्टी/i

export function createInterviewProposal(statement: string, replyLanguage: DetectedLanguage = 'en'): InterviewTurnProposal {
  const lower = statement.toLowerCase()
  const beneficiaries = RELATIONSHIP_PATTERNS.filter((item) => item.pattern.test(statement)).map((item) => {
    const isSpecific = item.relationship === 'child' && PROPERTY_WORDS.test(statement)
    const specificBequest = isSpecific ? detectSpecificBequest(statement) : ''
    const share = item.relationship === 'spouse' && /\b(mostly|main|mainly|primary|residue|rest|everything|sab\s?kuch|baaki)\b|बाकी|सब कुछ|सारा|ज़्यादातर|ज्यादातर/i.test(lower)
      ? 'residue'
      : specificBequest
        ? 'specific bequest'
        : ''

    return {
      id: newId(),
      name: item.name,
      relationship: item.relationship,
      share,
      specificBequest,
      confidence: item.relationship === 'spouse' || specificBequest ? 0.88 : 0.72,
      status: 'pending' as const,
    }
  })

  const specific = beneficiaries.find((beneficiary) => beneficiary.specificBequest)
  const residue = beneficiaries.find((beneficiary) => beneficiary.share === 'residue')
  const assistantReply = buildSamairaReply(replyLanguage, residue?.name, specific?.name, specific?.specificBequest)

  return {
    id: newId(),
    originalStatement: statement,
    assistantReply,
    beneficiaries,
    followUpQuestion: buildFollowUp(replyLanguage, specific?.name),
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
}

export function applyInterviewProposal(data: WillData, proposal: InterviewTurnProposal): WillData {
  const knownAddresses = new Set(data.assets.immovableAssets.map((asset) => asset.address.trim().toLowerCase()))
  const newAssets = proposal.beneficiaries
    .filter((beneficiary) => beneficiary.specificBequest)
    .filter((beneficiary) => !knownAddresses.has(beneficiary.specificBequest.trim().toLowerCase()))
    .map((beneficiary) => newImmovableAsset(beneficiary.specificBequest))

  const newBeneficiaries = proposal.beneficiaries.map((beneficiary) =>
    newBeneficiary(
      beneficiary.name,
      beneficiary.relationship,
      beneficiary.specificBequest || beneficiary.share,
    ),
  )

  const confirmed: WillData = {
    ...data,
    assistantIntake: {
      ...data.assistantIntake,
      interviewProposals: data.assistantIntake.interviewProposals.map((item) =>
        item.id === proposal.id
          ? {
              ...item,
              status: 'confirmed',
              beneficiaries: item.beneficiaries.map((beneficiary) => ({ ...beneficiary, status: 'confirmed' })),
            }
          : item,
      ),
    },
    assets: {
      ...data.assets,
      immovableAssets: [...data.assets.immovableAssets, ...newAssets],
    },
    distribution: {
      ...data.distribution,
      scheme: data.distribution.scheme || (newAssets.length > 0 ? 'itemized' : 'all-in-one'),
      beneficiaries: mergeBeneficiaries(data.distribution.beneficiaries, newBeneficiaries),
    },
  }
  // A proposal that only suggests answers (no beneficiaries) must not touch the assets or the distribution scheme.
  return proposal.beneficiaries.length > 0 ? confirmed : { ...data, assistantIntake: confirmed.assistantIntake }
}

export function dismissInterviewProposal(data: WillData, proposalId: string): WillData {
  return {
    ...data,
    assistantIntake: {
      ...data.assistantIntake,
      interviewProposals: data.assistantIntake.interviewProposals.map((item) =>
        item.id === proposalId ? { ...item, status: 'dismissed' } : item,
      ),
    },
  }
}

function detectSpecificBequest(statement: string) {
  // Devanagari word order: "नोएडा का मकान" / "नोएडा वाला घर".
  const hindi = statement.match(/([\u0900-\u097F]+)\s+(?:का|की|के|वाला|वाली)\s+(मकान|घर|फ्लैट|प्लॉट|ज़मीन|जमीन|कोठी|प्रॉपर्टी|प्रोपर्टी)/)
  if (hindi) return `${hindi[1]} ${hindi[2]}`

  const locationMatch = statement.match(/\b(?:in|at)\s+([A-Z]?[A-Za-z\s]+?)(?:\s+(?:property|house|flat|plot|apartment|villa)|[.!,]|$)/i)
  // Hinglish word order: "Noida wala ghar" / "Noida ka flat".
  const hinglishMatch = statement.match(/\b([A-Za-z]+)\s+(?:wala|wali|ka|ki)\s+(?:property|house|flat|plot|apartment|villa|ghar|makaan|makan|zameen|jameen|kothi)\b/i)
  const assetMatch = statement.match(new RegExp(PROPERTY_WORDS.source, 'i'))
  const rawAsset = assetMatch?.[1]?.toLowerCase() ?? 'property'
  const asset = /^(ghar|makaan|makan|kothi)$/.test(rawAsset) ? 'house' : /^(zameen|jameen)$/.test(rawAsset) ? 'land' : rawAsset
  const location = (hinglishMatch?.[1] ?? locationMatch?.[1])?.trim()
  return location ? `${titleCase(location)} ${asset}` : asset
}

// Offline replies in the language the user spoke. (With AI configured, the model writes these instead.)
const HINDI_RELATION: Record<string, string> = { Wife: 'पत्नी', Husband: 'पति', Daughter: 'बेटी', Son: 'बेटा', Parent: 'माता-पिता' }
const hindiName = (name: string) => HINDI_RELATION[name] ?? name

function buildSamairaReply(language: DetectedLanguage, residueName?: string, specificName?: string, specificBequest?: string) {
  if (language === 'hi') {
    const parts = []
    if (residueName) parts.push(`मैं ${hindiName(residueName)} को मुख्य लाभार्थी के रूप में दर्ज कर रही हूँ।`)
    if (specificName && specificBequest) parts.push(`${specificBequest} को ${hindiName(specificName)} के लिए विशेष उपहार के रूप में दर्ज कर रही हूँ।`)
    return parts.length ? `समझ गई। ${parts.join(' ')}` : 'समझ गई। मुझे कुछ जानकारी मिली है, लेकिन इसे ठीक से दर्ज करने के लिए एक और बात चाहिए।'
  }
  if (language === 'hinglish') {
    const parts = []
    if (residueName) parts.push(`Main ${residueName.toLowerCase()} ko primary/residue beneficiary note kar rahi hoon.`)
    if (specificName && specificBequest) parts.push(`${specificBequest} ko ${specificName.toLowerCase()} ke liye specific bequest note kar rahi hoon.`)
    return parts.length ? `Samajh gayi. ${parts.join(' ')}` : 'Samajh gayi. Mujhe kuch estate-planning ki jaankari mili hai, par ise theek se note karne ke liye ek aur detail chahiye.'
  }
  const parts = []
  if (residueName) parts.push(`I'll record ${residueName.toLowerCase()} as the primary/residue beneficiary.`)
  if (specificName && specificBequest) {
    parts.push(`I'll record ${specificBequest} as a specific bequest to ${specificName.toLowerCase()}.`)
  }
  if (!parts.length) {
    return "Understood. I found some estate-planning intent, but I need one more detail before I can structure it confidently."
  }
  return `Understood. ${parts.join(' ')}`
}

function buildFollowUp(language: DetectedLanguage, specificName?: string) {
  if (language === 'hi') return specificName ? `क्या ${hindiName(specificName)} को कुछ और भी देना चाहेंगे?` : 'क्या मैं कोई विशेष संपत्ति किसी को देने के लिए दर्ज करूँ, या बाकी सब शेष संपत्ति में रखूँ?'
  if (language === 'hinglish') return specificName ? `Kya ${specificName.toLowerCase()} ko aur kuch dena chahte hain?` : 'Kya main koi specific asset kisi ko dene ke liye note karun, ya baaki sab residue mein rakhun?'
  return specificName ? `Do you also want ${specificName.toLowerCase()} to receive anything else?` : 'Should I record any specific asset gifts, or should this be a general/residue instruction?'
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

function newBeneficiary(name: string, relationship: Beneficiary['relationship'], share: string): Beneficiary {
  return {
    id: newId(),
    name,
    relationship,
    share,
    substituteBeneficiary: '',
  }
}

// Returns new objects instead of mutating `existing`: those objects are live form state,
// and mutating them in place bypasses react-hook-form and silently drops the update.
function mergeBeneficiaries(existing: Beneficiary[], incoming: Beneficiary[]) {
  const next = existing.map((item) => ({ ...item }))
  for (const beneficiary of incoming) {
    const index = next.findIndex((item) => item.name.trim().toLowerCase() === beneficiary.name.trim().toLowerCase())
    if (index >= 0) {
      const match = next[index]
      const parts = match.share.split(' + ').map((part) => part.trim().toLowerCase())
      const addition = beneficiary.share && !parts.includes(beneficiary.share.trim().toLowerCase()) ? beneficiary.share : ''
      next[index] = {
        ...match,
        share: [match.share, addition].filter(Boolean).join(' + '),
        relationship: match.relationship || beneficiary.relationship,
      }
    } else {
      next.push(beneficiary)
    }
  }
  return next
}

function titleCase(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ')
}

const asText = (value: unknown, max = 500) => (typeof value === 'string' ? value : value == null ? '' : String(value)).trim().slice(0, max)

function asRelationship(value: unknown): RelationshipType | '' {
  const text = asText(value, 40).toLowerCase()
  if (text === 'spouse' || text === 'child' || text === 'parent' || text === 'other') return text
  return text ? classifyRelationship(text) : ''
}

/**
 * Combine the deterministic local interpretation with an AI response. The AI
 * output is untrusted: every field is coerced to the expected type, so a
 * malformed response can never put a non-string into the form or crash a screen.
 */
export function normalizeProposal(
  originalStatement: string,
  localProposal: InterviewTurnProposal,
  aiProposal?: Partial<Omit<InterviewTurnProposal, 'fieldUpdates'>> | null,
): InterviewTurnProposal {
  if (!aiProposal || typeof aiProposal !== 'object') return localProposal

  const aiBeneficiaries = (Array.isArray(aiProposal.beneficiaries) ? aiProposal.beneficiaries : [])
    .slice(0, 10)
    .map((item) => {
      const source = (item ?? {}) as unknown as Record<string, unknown>
      const confidence = Number(source.confidence)
      return {
        id: newId(),
        name: asText(source.name, 120),
        relationship: asRelationship(source.relationship),
        share: asText(source.share, 120),
        specificBequest: asText(source.specificBequest, 200),
        confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.7,
        status: 'pending' as const,
      }
    })
    .filter((item) => item.name)

  return {
    ...localProposal,
    assistantReply: asText(aiProposal.assistantReply, 800) || localProposal.assistantReply,
    followUpQuestion: asText(aiProposal.followUpQuestion, 400) || localProposal.followUpQuestion,
    beneficiaries: aiBeneficiaries.length > 0 ? aiBeneficiaries : localProposal.beneficiaries,
    originalStatement,
  }
}
