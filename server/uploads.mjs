import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { httpError } from './auth.mjs'
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

function uploadDir() {
  return path.resolve(process.cwd(), process.env.LOCAL_UPLOAD_DIR || '.local-uploads')
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
  return path.join(uploadDir(), uploadId)
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

  return upsertRecord(
    'uploads',
    { id: uploadId, status: 'uploaded', storedBytes: received, uploadedAt: new Date().toISOString() },
    actor,
  )
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
