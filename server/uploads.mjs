import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { httpError } from './auth.mjs'
import { isMalwareScanConfigured, scanForMalware } from './malwareScan.mjs'
import { canRead, canWrite, getAuthorizedRecord, getRecord, upsertRecord } from './store.mjs'

const SIGNED_URL_TTL_MS = 15 * 60 * 1000

const ALLOWED_MIME = [
  /^application\/pdf$/,
  /^image\/(png|jpe?g|webp|heic|heif|gif|tiff?)$/,
  /^video\/(mp4|quicktime|webm|x-matroska|mpeg|3gpp)$/,
  /^audio\/(mpeg|mp3|mp4|m4a|x-m4a|wav|x-wav|webm|ogg|aac|flac)$/,
  /^text\/(plain|csv)$/,
  /^application\/msword$/,
  /^application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)$/,
  /^application\/vnd\.ms-excel$/,
]

const ISO_BMFF = (buffer) => buffer.length >= 12 && buffer.subarray(4, 8).toString('latin1') === 'ftyp' // mp4/mov/heic/m4a family
const RIFF = (marker) => (buffer) => buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === marker
const OLE_COMPOUND = (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) // legacy .doc/.xls
const ZIP = (buffer) => buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]) // .docx/.xlsx

/**
 * Known file signatures for the MIME types accepted above, so a renamed/disguised file (e.g. an executable saved
 * as "photo.png") is caught before it is ever stored or served to a lawyer/advisor. A type left out of this table
 * (plain text, or a container format too variable to fingerprint reliably) is not checked, rather than risk
 * rejecting a legitimate upload on a guess.
 */
const MAGIC_SIGNATURES = {
  'application/pdf': (buffer) => buffer.subarray(0, 4).toString('latin1') === '%PDF',
  'image/png': (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (buffer) => buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  'image/jpg': (buffer) => buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  'image/gif': (buffer) => ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('latin1')),
  'image/webp': RIFF('WEBP'),
  'image/tiff': (buffer) => ['II*\u0000', 'MM\u0000*'].includes(buffer.subarray(0, 4).toString('latin1')),
  'image/tif': (buffer) => ['II*\u0000', 'MM\u0000*'].includes(buffer.subarray(0, 4).toString('latin1')),
  'image/heic': ISO_BMFF,
  'image/heif': ISO_BMFF,
  'video/mp4': ISO_BMFF,
  'video/quicktime': ISO_BMFF,
  'audio/mp4': ISO_BMFF,
  'audio/m4a': ISO_BMFF,
  'audio/x-m4a': ISO_BMFF,
  'video/webm': (buffer) => buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  'audio/webm': (buffer) => buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  'video/x-matroska': (buffer) => buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  'audio/wav': RIFF('WAVE'),
  'audio/x-wav': RIFF('WAVE'),
  'audio/ogg': (buffer) => buffer.subarray(0, 4).toString('latin1') === 'OggS',
  'audio/flac': (buffer) => buffer.subarray(0, 4).toString('latin1') === 'fLaC',
  'audio/mpeg': (buffer) => buffer.subarray(0, 3).toString('latin1') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0),
  'audio/mp3': (buffer) => buffer.subarray(0, 3).toString('latin1') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0),
  'application/msword': OLE_COMPOUND,
  'application/vnd.ms-excel': OLE_COMPOUND,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ZIP,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ZIP,
}

/** True unless the declared MIME type has a known signature and the file's actual bytes don't match it. */
async function contentMatchesDeclaredType(filePath, mimeType) {
  const check = MAGIC_SIGNATURES[mimeType]
  if (!check) return true
  const handle = await fsp.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(16)
    const { bytesRead } = await handle.read(buffer, 0, 16, 0)
    return check(buffer.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

// Files live on local disk, same single-instance limitation the pre-Postgres store had: fine for one machine,
// not for a multi-instance deploy (each instance would only see its own uploads) or for scaling storage
// independently of compute. Moving to an object store (S3, GCS, R2, ...) is a deliberate follow-up once a
// provider is chosen -- deferred here since there are no bucket/credentials to build and test against.
function uploadDir() {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.LOCAL_UPLOAD_DIR || '.local-uploads')
}

export function maxUploadBytes() {
  return Number.parseInt(process.env.MAX_UPLOAD_BYTES || String(200 * 1024 * 1024), 10)
}

export function normalizeMimeType(mimeType) {
  // Browsers report audio recorded via MediaRecorder as e.g. "audio/webm;codecs=opus".
  return String(mimeType || '').split(';')[0].trim().toLowerCase()
}

export function isAllowedMimeType(mimeType) {
  return ALLOWED_MIME.some((pattern) => pattern.test(normalizeMimeType(mimeType)))
}

function filePathFor(uploadId) {
  return path.join(/*turbopackIgnore: true*/ uploadDir(), uploadId)
}

export async function createSignedUpload({ fileName, mimeType, fileSize, documentType }, actor) {
  if (typeof fileName !== 'string' || !fileName.trim()) throw httpError(400, 'fileName is required')
  const mime = normalizeMimeType(mimeType)
  if (!isAllowedMimeType(mime)) throw httpError(415, `Files of type "${mime || 'unknown'}" are not accepted`)
  const size = Number(fileSize)
  if (!Number.isFinite(size) || size <= 0) throw httpError(400, 'fileSize must be a positive number')
  if (size > maxUploadBytes()) throw httpError(413, `File exceeds the ${Math.round(maxUploadBytes() / 1024 / 1024)}MB upload limit`)

  const uploadId = crypto.randomUUID()
  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150)
  return upsertRecord(
    'uploads',
    {
      id: uploadId,
      fileName: safeName,
      mimeType: mime,
      fileSize: size,
      documentType: String(documentType || 'unknown').slice(0, 40),
      storageKey: `${uploadId}-${safeName}`,
      status: 'signed',
      uploadUrl: `/api/uploads/${uploadId}`,
      expiresAt: new Date(Date.now() + SIGNED_URL_TTL_MS).toISOString(),
    },
    actor,
  )
}

export async function receiveUpload(uploadId, request, actor) {
  const record = await getAuthorizedRecord('uploads', uploadId, actor)
  if (record.ownerId !== (actor?.sub ?? actor) && actor?.role !== 'admin') throw httpError(403, 'Not your upload')
  if (record.status !== 'signed') throw httpError(409, 'This upload URL has already been used')
  if (Date.parse(record.expiresAt) < Date.now()) throw httpError(410, 'This upload URL has expired')

  const declared = Number(request.headers['content-length'])
  const limit = Math.min(record.fileSize, maxUploadBytes())
  if (Number.isFinite(declared) && declared > limit) throw httpError(413, 'Upload is larger than the declared file size')

  await fsp.mkdir(uploadDir(), { recursive: true })
  const finalPath = filePathFor(uploadId)
  const tempPath = `${finalPath}.${crypto.randomUUID()}.part`
  let received = 0
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length
      if (received > limit) callback(httpError(413, 'Upload is larger than the declared file size'))
      else callback(null, chunk)
    },
  })

  try {
    await pipeline(request, counter, fs.createWriteStream(tempPath))
    await fsp.rename(tempPath, finalPath)
  } catch (error) {
    await fsp.rm(tempPath, { force: true })
    throw error
  }

  const rejection = await inspectUploadedFile(finalPath, record.mimeType)
  if (rejection) {
    await fsp.rm(finalPath, { force: true })
    await upsertRecord('uploads', { id: uploadId, status: 'rejected', rejectedReason: rejection }, actor)
    throw httpError(415, rejection)
  }

  return upsertRecord(
    'uploads',
    { id: uploadId, status: 'uploaded', storedBytes: received, uploadedAt: new Date().toISOString() },
    actor,
  )
}

/** Content checks run once, after the bytes are on disk: a magic-byte match against the declared type, then an
 * antivirus scan if one is configured. Returns a rejection reason, or undefined if the file is clean. */
async function inspectUploadedFile(filePath, mimeType) {
  if (!(await contentMatchesDeclaredType(filePath, mimeType))) {
    return 'File content does not match its declared type'
  }
  if (isMalwareScanConfigured()) {
    // Fails closed: a scan that could not run (daemon down, network error) is treated the same as an infected result.
    let result
    try {
      result = await scanForMalware(filePath)
    } catch {
      return 'This file could not be scanned and was rejected'
    }
    if (!result.clean) return 'This file was rejected by malware scanning'
  }
  return undefined
}

/** Read a stored upload fully into memory (only for files small enough to hand to an AI provider). */
export async function readUploadedFile(uploadId, actor, { maxBytes = Infinity } = {}) {
  const record = await getAuthorizedRecord('uploads', uploadId, actor)
  if (record.status !== 'uploaded') throw httpError(409, 'Upload has not completed')
  if (record.storedBytes > maxBytes) return { record, buffer: null }
  return { record, buffer: await fsp.readFile(filePathFor(uploadId)) }
}

export async function openUploadStream(uploadId, actor, { extraAccess } = {}) {
  const record = await getRecord('uploads', uploadId)
  // `extraAccess` lets the caller grant case-scoped access (e.g. an assigned lawyer reading a client's document).
  const allowed = record && (canRead(record, actor) || (extraAccess ? await extraAccess(record) : false))
  if (!allowed || record.status !== 'uploaded') throw httpError(404, 'Not found')
  return { record, stream: fs.createReadStream(filePathFor(uploadId)) }
}

export async function removeUpload(uploadId, actor) {
  const record = await getAuthorizedRecord('uploads', uploadId, actor)
  // Check write access BEFORE touching the file: read-only parties (shared lawyer) must not be able to destroy it.
  if (!canWrite(record, actor)) throw httpError(403, 'Only the owner can delete this file')
  await fsp.rm(filePathFor(uploadId), { force: true })
  return upsertRecord('uploads', { id: record.id, status: 'deleted', deletedAt: new Date().toISOString() }, actor)
}
