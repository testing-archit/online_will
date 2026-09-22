import crypto from 'node:crypto'
import {
  analyzeDocumentWithGemini,
  isGeminiConfigured,
  MAX_INLINE_BYTES,
} from './gemini.mjs'
import { normalizeMimeType, readUploadedFile } from './uploads.mjs'
import { upsertRecord } from './store.mjs'
import { httpError } from './auth.mjs'

// Order matters: specific document types must be tested before generic ones
// (a "CAS statement" is a CAS, not a bank statement).
const FILE_NAME_RULES = [
  ['existing-will', /\b(will|codicil|testament)\b/],
  ['loan', /\b(loan|mortgage|pledge|emi)\b/],
  ['cas', /\b(cas|consolidated[-_ ]account)\b/],
  ['demat', /\b(demat|holdings?|nsdl|cdsl)\b/],
  ['insurance', /\b(insurance|policy|lic|premium)\b/],
  ['property', /\b(property|deed|registry|khasra|khatauni|flat|plot|sale[-_ ]deed|conveyance)\b/],
  ['bank', /\b(bank|passbook|fd|fixed[-_ ]deposit|account[-_ ]statement|statement)\b/],
  ['business', /\b(company|business|partnership|llp|shareholding|moa|aoa)\b/],
  ['vehicle', /\b(vehicle|car|rc|registration[-_ ]certificate)\b/],
  ['pan', /\bpan\b/],
  ['id', /\b(aadhaar|aadhar|passport|voter|driving[-_ ]licen[sc]e|id)\b/],
]

const GEMINI_INLINE_MIME = /^(application\/pdf|image\/(png|jpe?g|webp|heic|heif)|text\/plain)$/

export function classifyFileName(fileName) {
  // Treat "_" and "." as separators so "CAS_statement.pdf" tokenizes on word boundaries.
  const normalized = String(fileName).toLowerCase().replace(/[_.]+/g, ' ')
  const match = FILE_NAME_RULES.find(([, pattern]) => pattern.test(normalized))
  return match?.[0] ?? 'unknown'
}

function localClassify(fileName) {
  const category = classifyFileName(fileName)
  return {
    id: crypto.randomUUID(),
    fileName,
    category,
    confidence: category === 'unknown' ? 0.25 : 0.65,
    extractedMetadata: {},
    reconciliationNotes: [],
    extractedAssets: [],
    status: category === 'unknown' ? 'needs_review' : 'classified',
  }
}

export async function classifyDocumentWithFallback(
  { fileName, mimeType, base64Data, uploadId, estateSnapshot },
  actor,
) {
  if (typeof fileName !== 'string' || !fileName.trim()) throw httpError(400, 'fileName is required')

  // Prefer the file we already stored (owner-checked) over re-sending bytes in the request.
  let data = typeof base64Data === 'string' ? base64Data : ''
  let mime = normalizeMimeType(mimeType)
  if (uploadId) {
    const { record, buffer } = await readUploadedFile(uploadId, actor, { maxBytes: MAX_INLINE_BYTES })
    mime = normalizeMimeType(record.mimeType)
    data = buffer ? buffer.toString('base64') : ''
  }
  if (data.length > MAX_INLINE_BYTES * 1.4) data = ''

  let result = null
  if (isGeminiConfigured()) {
    try {
      const inline = data && GEMINI_INLINE_MIME.test(mime) ? { base64Data: data, mimeType: mime } : {}
      result = await analyzeDocumentWithGemini({ fileName, estateSnapshot, ...inline })
    } catch (error) {
      console.warn(`Document AI analysis failed, using filename classification: ${error.message}`)
    }
  }

  return upsertRecord('documents', { ...(result ?? localClassify(fileName)), ...(uploadId ? { uploadId } : {}) }, actor)
}
