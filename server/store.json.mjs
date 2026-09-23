import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { httpError } from './auth.mjs'
import { canRead, canWrite, normalizeActor } from './storeAccess.mjs'

// Local JSON persistence: the zero-config default backend. Same collections and semantics (ownership, optimistic
// versioning, immutable history, append-only audit) as the Postgres backend in store.pg.mjs, used automatically
// when DATABASE_URL is not set -- see server/store.mjs.

const HISTORY_LIMIT_PER_RECORD = 50
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

function dataDir() {
  return path.resolve(process.cwd(), process.env.LOCAL_DATA_DIR || '.local-data')
}

function dataPath() {
  return path.join(dataDir(), 'app-data.json')
}

function createEmptyStore() {
  return {
    users: {},
    wills: {},
    documents: {},
    notificationJobs: {},
    consultations: {},
    reviewEvents: {},
    comments: {},
    uploads: {},
    history: {},
    auditLog: [],
  }
}

// All read-modify-write cycles go through this queue so concurrent requests
// cannot interleave and lose updates.
let queue = Promise.resolve()

function withLock(task) {
  const run = queue.then(task, task)
  queue = run.catch(() => {})
  return run
}

export async function readStore() {
  try {
    const raw = await fs.readFile(dataPath(), 'utf8')
    return { ...createEmptyStore(), ...JSON.parse(raw) }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return createEmptyStore()
  }
}

async function writeStore(nextStore) {
  await fs.mkdir(dataDir(), { recursive: true })
  const target = dataPath()
  const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temp, JSON.stringify(nextStore, null, 2))
  await fs.rename(temp, target)
}

/**
 * Create or update a record. Enforces ownership on updates, optimistic
 * concurrency (`baseVersion`) and keeps an immutable history snapshot when
 * `keepHistory` is set.
 */
export function upsertRecord(collection, record, actor, { keepHistory = false, baseVersion, skipOwnerCheck = false } = {}) {
  return withLock(async () => {
    const who = normalizeActor(actor)
    const store = await readStore()
    const id = record.id ?? crypto.randomUUID()
    if (!ID_PATTERN.test(id)) throw httpError(400, 'Invalid record id')

    store[collection] ??= {}
    const existing = store[collection][id]
    // `skipOwnerCheck` is for callers that already verified access through a
    // parent record (e.g. a lawyer resolving a thread on an assigned will).
    if (existing && !skipOwnerCheck && !canWrite(existing, actor)) {
      throw httpError(403, 'You do not have access to this record')
    }
    if (existing && baseVersion !== undefined && baseVersion !== existing.version) {
      throw httpError(409, `Version conflict: server has version ${existing.version}`)
    }

    const now = new Date().toISOString()
    const next = {
      ...existing,
      ...record,
      id,
      ownerId: existing?.ownerId ?? who.sub,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
    }
    store[collection][id] = next

    if (keepHistory) {
      const key = `${collection}:${id}`
      const snapshots = store.history[key] ?? []
      snapshots.push({ version: next.version, savedAt: now, savedBy: who.sub, snapshot: structuredClone(next) })
      store.history[key] = snapshots.slice(-HISTORY_LIMIT_PER_RECORD)
    }

    store.auditLog.push({
      id: crypto.randomUUID(),
      actorId: who.sub,
      actorRole: who.role,
      collection,
      recordId: id,
      action: existing ? 'update' : 'create',
      version: next.version,
      createdAt: now,
    })
    await writeStore(store)
    return next
  })
}

export async function getRecord(collection, id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null
  const store = await readStore()
  return store[collection]?.[id] ?? null
}

/** Fetch a record and enforce read access. Throws 404 rather than 403 to avoid leaking existence. */
export async function getAuthorizedRecord(collection, id, actor) {
  const record = await getRecord(collection, id)
  if (!record || !canRead(record, actor)) throw httpError(404, 'Not found')
  return record
}

export async function listRecords(collection, predicate) {
  const store = await readStore()
  const rows = Object.values(store[collection] ?? {})
  return predicate ? rows.filter(predicate) : rows
}

export async function listVersions(collection, id) {
  const store = await readStore()
  return (store.history[`${collection}:${id}`] ?? []).map(({ version, savedAt, savedBy }) => ({
    version,
    savedAt,
    savedBy,
  }))
}

export async function deleteRecord(collection, id, actor) {
  return withLock(async () => {
    const store = await readStore()
    const existing = store[collection]?.[id]
    if (!existing || !canWrite(existing, actor)) throw httpError(404, 'Not found')
    delete store[collection][id]
    const who = normalizeActor(actor)
    store.auditLog.push({
      id: crypto.randomUUID(),
      actorId: who.sub,
      actorRole: who.role,
      collection,
      recordId: id,
      action: 'delete',
      createdAt: new Date().toISOString(),
    })
    await writeStore(store)
    return existing
  })
}

export function appendAudit(entry) {
  return withLock(async () => {
    const store = await readStore()
    const { actor, ...rest } = entry
    const who = normalizeActor(actor)
    store.auditLog.push({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      actorId: who.sub,
      actorRole: who.role,
      ...rest,
    })
    await writeStore(store)
  })
}

/**
 * Marks every due, still-scheduled notificationJob as "sending" and returns them, all inside one queued task --
 * this backend only ever runs in one process, so the queue alone is enough to make the claim atomic (the
 * Postgres backend's claimDueJobs does the equivalent with a single SQL statement, safe across processes too).
 */
export function claimDueJobs(now = Date.now()) {
  return withLock(async () => {
    const store = await readStore()
    const due = Object.values(store.notificationJobs ?? {}).filter((job) => job.status === 'scheduled' && (!job.runAt || Date.parse(job.runAt) <= now))
    if (due.length === 0) return []
    const updatedAt = new Date().toISOString()
    const claimed = due.map((job) => ({ ...job, status: 'sending', updatedAt, version: job.version + 1 }))
    for (const job of claimed) store.notificationJobs[job.id] = job
    await writeStore(store)
    return claimed
  })
}
