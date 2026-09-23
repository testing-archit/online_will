import crypto from 'node:crypto'
import knowledgeBase from '../shared/legal-knowledge.json' with { type: 'json' }
import companyKnowledgeBase from '../shared/company-knowledge.json' with { type: 'json' }
import { httpError } from './auth.mjs'
import {
  analyzeExecutionRecordingWithGemini,
  callGeminiOrNull,
  isGeminiConfigured,
  MAX_INLINE_BYTES,
} from './gemini.mjs'
import { appendAudit, upsertRecord } from './store.mjs'
import { readUploadedFile } from './uploads.mjs'

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'my', 'me', 'i', 'of', 'to', 'in', 'for', 'on', 'and', 'or',
  'is', 'are', 'do', 'does', 'have', 'has', 'show', 'find', 'which', 'what',
  'all', 'everything', 'related', 'documents', 'document', 'can', 'be', 'a', 'it', 'if',
])

function tokenize(query) {
  return String(query ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

function documentText(document, estateSnapshot) {
  const related = []
  const assets = estateSnapshot?.assets
  if (document.category === 'property') {
    for (const asset of assets?.immovableAssets ?? []) related.push(asset.address, asset.surveyNumber, asset.registryDetails)
  }
  if (['bank', 'cas', 'demat'].includes(document.category)) {
    for (const account of assets?.bankAccounts ?? []) related.push(account.bankName, account.branch)
    for (const investment of assets?.investments ?? []) related.push(investment.type, investment.identifier, investment.description)
  }
  if (document.category === 'insurance') {
    for (const policy of estateSnapshot?.insurance?.policies ?? []) related.push(policy.insurer, policy.policyNumber, policy.nomineeName)
  }
  return [
    document.fileName,
    document.category,
    Object.values(document.extractedMetadata ?? {}).join(' '),
    (document.reconciliationNotes ?? []).join(' '),
    related.join(' '),
  ]
    .join(' ')
    .toLowerCase()
}

export function keywordSearchVault(documents, estateSnapshot, query) {
  const tokens = tokenize(query)
  if (!tokens.length) return []

  return (Array.isArray(documents) ? documents : [])
    .map((document) => {
      const text = documentText(document, estateSnapshot)
      const hits = tokens.filter((token) => text.includes(token))
      return {
        documentId: document.id,
        fileName: document.fileName,
        category: document.category,
        snippet: document.extractedMetadata?.title || document.fileName,
        score: hits.length / tokens.length,
      }
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
}

// Task 35 — RAG over the caller's own document vault. Retrieval is keyword
// based; the model only rewords what retrieval found.
export async function searchVaultDocuments({ query, documents, estateSnapshot }, user) {
  if (!query?.trim()) throw httpError(400, 'query is required')
  const results = keywordSearchVault(documents ?? estateSnapshot?.documentVault?.documents, estateSnapshot, query)

  let answer = null
  if (results.length > 0) {
    answer = await callGeminiOrNull({
      temperature: 0.2,
      json: false,
      system: "Answer questions strictly about the user's own uploaded estate documents listed in the data. Only use the provided document metadata. Never invent document contents. Be concise.",
      prompt: `<user_data name="question">${String(query).slice(0, 500)}</user_data>\n<user_data name="matching_documents">${JSON.stringify(results)}</user_data>`,
    })
  }

  answer ??= results.length
    ? [`${results.length} document(s) match "${query}":`, ...results.map((r) => `${r.fileName} (${r.category}, ${Math.round(r.score * 100)}% match) — ${r.snippet}`)].join('\n')
    : `No documents in the vault match "${query}".`

  await appendAudit({ actor: user, action: 'document-search', summary: String(query).slice(0, 120) })
  return { answer, results }
}

// ----------------------------------------------------------- legal knowledge

function retrieveSources(question) {
  const tokens = tokenize(question).filter((token) => token.length > 2)
  return knowledgeBase.sources
    .map((source) => {
      const hits = source.keywords.filter((keyword) =>
        tokens.some((token) => token === keyword || (token.length >= 4 && keyword.startsWith(token)) || (keyword.length >= 4 && token.startsWith(keyword))),
      )
      return { source, relevance: hits.length / Math.max(source.keywords.length, 1) + hits.length * 0.05 }
    })
    .filter((row) => row.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 3)
    .map((row) => row.source)
}

export function getKnowledgeBaseVersion() {
  return knowledgeBase.version
}

// Task 36 — Legal knowledge assistant. The server owns the approved knowledge
// base: the client sends only the question, so a caller cannot smuggle in
// unapproved "sources". The model may only answer from the retrieved excerpts.
export async function answerLegalQuestion({ question }, user) {
  if (!question?.trim()) throw httpError(400, 'question is required')
  const retrieved = retrieveSources(question)

  if (retrieved.length === 0) {
    await appendAudit({ actor: user, action: 'legal-knowledge-query', summary: `[no source] ${String(question).slice(0, 110)}` })
    return {
      answer:
        'No approved source in the Octaraa legal knowledge base covers this question. This assistant only answers from reviewed material — please raise it with the consulting lawyer.',
      sources: [],
      knowledgeBaseVersion: knowledgeBase.version,
    }
  }

  const generated = await callGeminiOrNull({
    temperature: 0.1,
    json: false,
    system: [
      'You are a legal knowledge assistant for an Indian Will-drafting platform.',
      'Answer ONLY using the approved source excerpts in the data. If the excerpts do not cover the question, say so.',
      'Cite the source title and citation for every statement. Never invent legal rules. Keep the answer under 200 words.',
    ].join('\n'),
    prompt: [
      `<user_data name="question">${String(question).slice(0, 500)}</user_data>`,
      ...retrieved.map((source) => `SOURCE — ${source.title} (${source.citation}):\n${source.content}`),
    ].join('\n\n'),
  })

  const answer =
    generated ??
    [
      'Based on the approved Octaraa legal knowledge base:',
      '',
      ...retrieved.map((source) => `${source.title} (${source.citation}):\n${source.content}`),
      '',
      'This is general information from curated sources, not legal advice for your specific situation.',
    ].join('\n')

  await appendAudit({ actor: user, action: 'legal-knowledge-query', summary: String(question).slice(0, 120) })
  return {
    answer,
    sources: retrieved.map(({ id, title, citation }) => ({ id, title, citation })),
    knowledgeBaseVersion: knowledgeBase.version,
  }
}

// --------------------------------------------------------- company knowledge

/** Retrieval over both the company FAQ base and the legal knowledge base -- a question like "do I need witnesses"
 * is as much a company question (what Octaraa checks for you) as a legal one, and this assistant is the one place
 * both get asked. Same control as answerLegalQuestion: retrieval decides what's in scope, the model only rewords it. */
function retrieveCompanySources(question) {
  const tokens = tokenize(question).filter((token) => token.length > 2)
  const score = (source) => {
    const hits = source.keywords.filter((keyword) =>
      tokens.some((token) => token === keyword || (token.length >= 4 && keyword.startsWith(token)) || (keyword.length >= 4 && token.startsWith(keyword))),
    )
    return hits.length / Math.max(source.keywords.length, 1) + hits.length * 0.05
  }
  const company = companyKnowledgeBase.sources.map((source) => ({ source, relevance: score(source), kind: 'company' }))
  const legal = knowledgeBase.sources.map((source) => ({ source, relevance: score(source), kind: 'legal' }))
  return [...company, ...legal]
    .filter((row) => row.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 3)
}

// Matches ONLY a message that is nothing but a greeting/pleasantry (short, no other words) -- "hi, do you need witnesses" still goes to retrieval.
const GREETING = /^(hi+|hello+|hey+|yo|namaste|namaskar|good\s?(morning|afternoon|evening)|how\s?are\s?you|what'?s\s?up|thanks?( you)?|thank\s?you|ok(ay)?|bye|goodbye)[!.? ]*$/i

const COMPANY_RATE_LIMIT = { limit: 20, windowMs: 60_000 }
const companyRateBuckets = new Map()

/** Public, unauthenticated (anyone on the landing page can ask), so this is rate-limited per caller IP rather than
 * per account. `caller` is whatever the route passes -- typically the request's socket address; a proxy in front
 * of the API should forward the real client IP, otherwise every visitor behind it shares one bucket. */
function enforceCompanyRateLimit(caller) {
  const now = Date.now()
  const key = String(caller || 'unknown')
  const recent = (companyRateBuckets.get(key) ?? []).filter((time) => now - time < COMPANY_RATE_LIMIT.windowMs)
  if (recent.length >= COMPANY_RATE_LIMIT.limit) throw httpError(429, 'Too many questions — please slow down')
  recent.push(now)
  companyRateBuckets.set(key, recent)
}

/**
 * The landing-page assistant: general Q&A about Octaraa itself (what it is, how it works, the legal review, the
 * language options) and general education on Will-related legal/financial topics, for a visitor who has not
 * started a Will yet. Same grounding discipline as answerLegalQuestion -- answers only from the two approved
 * knowledge bases above, and says plainly when something is not covered rather than guessing. In particular, the
 * knowledge base deliberately has NO entries for pricing beyond "starting is free", founder/team bios or company
 * history -- so a question about any of those gets the honest "not covered" answer instead of an invented one.
 */
export async function answerCompanyQuestion({ question }, caller) {
  if (!question?.trim()) throw httpError(400, 'question is required')
  enforceCompanyRateLimit(caller)
  const trimmed = question.trim()

  // A greeting or pleasantry isn't a question the knowledge base needs to cover -- treating it as one made "hi"
  // get the same "I don't have approved information" refusal as an out-of-scope question, which reads as a badly
  // broken bot rather than one being careful. Answered directly: fixed, friendly, no model call, nothing to invent.
  if (GREETING.test(trimmed)) {
    return { answer: "Hi! I'm here to answer questions about Octaraa -- how it works, the legal review, languages, anything before you start. What would you like to know?", sources: [] }
  }

  const retrieved = retrieveCompanySources(trimmed)
  const NO_INFO =
    "I don't have approved information on that yet — I can only answer from Octaraa's reviewed material. For anything about pricing beyond starting for free, the team, or the company's background, please reach out through the consultation form."

  // The model, not a hard "zero sources = refuse" gate, decides between chitchat, a covered question and an
  // uncovered one -- a gate keyed on retrieval alone treated every greeting my GREETING fast-path above missed
  // ("hey there", "good morning!") the same as an unanswerable question. The model already holds the actual safety
  // line here (verified: it declines to invent founders/pricing/history even when retrieval hands it a loosely
  // related source), so this asks it to do the same judgment call for chitchat instead of a regex trying to.
  const generated = await callGeminiOrNull({
    temperature: 0.2,
    json: false,
    system: [
      'You are the landing-page assistant for Octaraa, an Indian Will-drafting platform. You answer visitors who have not started a Will yet.',
      'If the message is a greeting or small talk rather than a real question, respond warmly and briefly and invite them to ask about Octaraa -- do not treat it as an unanswerable question.',
      'Otherwise, answer ONLY using the approved source excerpts given below, if any. If none are given, or they do not fully cover the question, say plainly that you do not have approved information on that and suggest the consultation form -- never fill the gap yourself.',
      'Never invent facts about Octaraa (pricing beyond what the excerpts state, the team, company history, guarantees).',
      'For anything touching a financial or legal decision (whether to make a Will, how to split assets, tax or investment questions), give only general education from the excerpts, never personalized advice, and say plainly that Octaraa is a drafting platform, not a law firm or financial advisor. Octaraa also offers wealth management (mutual funds, fixed deposits, portfolio review) on octaraa.com -- if asked, say that in one sentence and point them there; never discuss those products, give investment advice, or quote a number for them here.',
      'Keep the answer under 150 words, in plain language, no legal jargon.',
    ].join('\n'),
    prompt: [
      `<user_data name="question">${String(question).slice(0, 500)}</user_data>`,
      retrieved.length
        ? retrieved.map(({ source, kind }) => `SOURCE (${kind}) — ${source.title}${source.citation ? ` (${source.citation})` : ''}:\n${source.content}`).join('\n\n')
        : 'No approved source matched this question.',
    ].join('\n\n'),
  })

  const answer =
    generated ??
    (retrieved.length
      ? ['Based on the approved Octaraa knowledge base:', '', ...retrieved.map(({ source }) => `${source.title}:\n${source.content}`), '', 'This is general information, not personalized legal or financial advice.'].join('\n')
      : NO_INFO)

  return { answer, sources: retrieved.map(({ source, kind }) => ({ id: source.id, title: source.title, kind })) }
}

// ------------------------------------------------------- execution recordings

const GEMINI_VIDEO_MIME = /^video\/(mp4|mpeg|quicktime|webm|3gpp)$/

// Task 29/39 — the recording itself is stored via the signed-upload flow and
// referenced here; AI output is review assistance for a human reviewer, never
// a legal determination of validity.
export async function analyzeExecutionVideo({ fileName, uploadId, mimeType, base64Data, recordingMetadata, willVersion }, user) {
  if (!fileName) throw httpError(400, 'fileName is required')

  let bytes = null
  let mime = String(mimeType ?? '').split(';')[0].trim().toLowerCase()
  let skipReason = ''
  if (uploadId) {
    const { record, buffer } = await readUploadedFile(uploadId, user, { maxBytes: MAX_INLINE_BYTES })
    mime = record.mimeType
    bytes = buffer
    if (!buffer) skipReason = `The recording (${Math.round(record.storedBytes / 1024 / 1024)}MB) is stored securely but is too large for inline AI analysis — it needs manual review.`
  } else if (typeof base64Data === 'string' && base64Data.length <= MAX_INLINE_BYTES * 1.4) {
    bytes = Buffer.from(base64Data, 'base64')
  }

  let analysis = null
  if (bytes && GEMINI_VIDEO_MIME.test(mime) && isGeminiConfigured()) {
    try {
      analysis = await analyzeExecutionRecordingWithGemini({ mimeType: mime, base64Data: bytes.toString('base64'), recordingMetadata })
    } catch (error) {
      console.warn(`Execution recording analysis failed: ${error.message}`)
      skipReason = 'AI analysis was unavailable for this recording — it needs manual review.'
    }
  } else if (!skipReason) {
    skipReason = isGeminiConfigured()
      ? 'This recording format is not supported for AI analysis — it needs manual review.'
      : 'AI video analysis is not configured (GEMINI_API_KEY missing). The recording is stored for manual review.'
  }

  const result = {
    id: crypto.randomUUID(),
    fileName,
    uploadId: uploadId ?? '',
    willVersion: willVersion ?? '',
    createdAt: new Date().toISOString(),
    signingDetected: analysis?.signingDetected ?? null,
    witnessesPresent: analysis?.witnessesPresent ?? null,
    willReadingDetected: analysis?.willReadingDetected ?? null,
    participantNotes: analysis?.participantNotes ?? '',
    timelineNotes: analysis?.timelineNotes ?? '',
    rawSummary: analysis?.rawSummary || skipReason,
    status: 'pending_review',
  }

  await upsertRecord('executionAnalyses', result, user)
  await appendAudit({ actor: user, action: 'execution-video-analysis', summary: fileName.slice(0, 120) })
  return { analysis: result }
}
