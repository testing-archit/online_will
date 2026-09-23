import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { httpError } from './auth.mjs'
import { canRead, canWrite, normalizeActor } from './storeAccess.mjs'

// Postgres-backed persistence: same collections and semantics as store.json.mjs (ownership, optimistic
// versioning, immutable history, append-only audit), but with real transactions and row locks instead of an
// in-process JS queue -- so it survives crashes and works from more than one process. Selected automatically by
// server/store.mjs when DATABASE_URL is set. See database/store-schema.sql for the tables.

const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const HISTORY_LIMIT_PER_RECORD = 50

let pool
let schemaReady

function getPool() {
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    // An idle connection dropped by the database (restart, failover, network blip) is emitted here; without a
    // listener Node treats it as an uncaught error and exits. The pool discards that client and opens a new one.
    pool.on('error', (error) => console.error('Postgres idle client error:', error.message))
  }
  return pool
}

async function ensureSchema() {
  schemaReady ??= (async () => {
    const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'database', 'store-schema.sql')
    await getPool().query(await fs.readFile(schemaPath, 'utf8'))
  })()
  return schemaReady
}

async function withClient(task) {
  await ensureSchema()
  const client = await getPool().connect()
  try {
    return await task(client)
  } finally {
    client.release()
  }
}

async function withTransaction(task) {
  return withClient(async (client) => {
    await client.query('BEGIN')
    try {
      const result = await task(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      // A failed ROLLBACK (e.g. the connection itself died) must not hide the error that caused it.
      await client.query('ROLLBACK').catch(() => {})
      throw error
    }
  })
}

/** Closes the pool. Only tests need this, to let the process exit. */
export async function closePool() {
  if (pool) await pool.end()
  pool = undefined
  schemaReady = undefined
}

export function upsertRecord(collection, record, actor, { keepHistory = false, baseVersion, skipOwnerCheck = false } = {}) {
  return withTransaction(async (client) => {
    const who = normalizeActor(actor)
    const id = record.id ?? crypto.randomUUID()
    if (!ID_PATTERN.test(id)) throw httpError(400, 'Invalid record id')

    // Locks the row (if it exists) so a concurrent update to the SAME existing record serializes instead of
    // racing; a brand-new id supplied by the caller (rather than generated above) can still race on first
    // creation, same limitation the single-process JSON backend has always had.
    const { rows } = await client.query('select data from records where collection = $1 and id = $2 for update', [collection, id])
    const existing = rows[0]?.data
    if (existing && !skipOwnerCheck && !canWrite(existing, actor)) throw httpError(403, 'You do not have access to this record')
    if (existing && baseVersion !== undefined && baseVersion !== existing.version) throw httpError(409, `Version conflict: server has version ${existing.version}`)

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

    await client.query(
      `insert into records (collection, id, data, owner_id, version, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (collection, id) do update set data = $3, owner_id = $4, version = $5, updated_at = $7`,
      [collection, id, next, next.ownerId, next.version, next.createdAt, next.updatedAt],
    )

    if (keepHistory) {
      await client.query(
        'insert into record_history (collection, record_id, version, saved_at, saved_by, snapshot) values ($1, $2, $3, $4, $5, $6)',
        [collection, id, next.version, now, who.sub, next],
      )
      await client.query(
        `delete from record_history where collection = $1 and record_id = $2 and version <= (
           select version from record_history where collection = $1 and record_id = $2 order by version desc offset $3 limit 1
         )`,
        [collection, id, HISTORY_LIMIT_PER_RECORD],
      )
    }

    await appendAuditRow(client, { actorId: who.sub, actorRole: who.role, collection, recordId: id, action: existing ? 'update' : 'create', version: next.version, createdAt: now })
    return next
  })
}

export async function getRecord(collection, id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null
  return withClient(async (client) => {
    const { rows } = await client.query('select data from records where collection = $1 and id = $2', [collection, id])
    return rows[0]?.data ?? null
  })
}

/** Fetch a record and enforce read access. Throws 404 rather than 403 to avoid leaking existence. */
export async function getAuthorizedRecord(collection, id, actor) {
  const record = await getRecord(collection, id)
  if (!record || !canRead(record, actor)) throw httpError(404, 'Not found')
  return record
}

export async function listRecords(collection, predicate) {
  return withClient(async (client) => {
    if (collection === 'auditLog') {
      const { rows } = await client.query('select entry from audit_log order by created_at asc')
      const all = rows.map((row) => row.entry)
      return predicate ? all.filter(predicate) : all
    }
    const { rows } = await client.query('select data from records where collection = $1', [collection])
    const all = rows.map((row) => row.data)
    return predicate ? all.filter(predicate) : all
  })
}

export async function listVersions(collection, id) {
  return withClient(async (client) => {
    const { rows } = await client.query(
      'select version, saved_at, saved_by from record_history where collection = $1 and record_id = $2 order by version asc',
      [collection, id],
    )
    return rows.map((row) => ({ version: row.version, savedAt: row.saved_at.toISOString(), savedBy: row.saved_by }))
  })
}

export function deleteRecord(collection, id, actor) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('select data from records where collection = $1 and id = $2 for update', [collection, id])
    const existing = rows[0]?.data
    if (!existing || !canWrite(existing, actor)) throw httpError(404, 'Not found')
    await client.query('delete from records where collection = $1 and id = $2', [collection, id])
    const who = normalizeActor(actor)
    await appendAuditRow(client, { actorId: who.sub, actorRole: who.role, collection, recordId: id, action: 'delete', createdAt: new Date().toISOString() })
    return existing
  })
}

export function appendAudit(entry) {
  return withClient(async (client) => {
    const { actor, ...rest } = entry
    const who = normalizeActor(actor)
    await appendAuditRow(client, { actorId: who.sub, actorRole: who.role, createdAt: new Date().toISOString(), ...rest })
  })
}

async function appendAuditRow(client, fields) {
  const entry = { id: crypto.randomUUID(), ...fields }
  await client.query('insert into audit_log (id, entry, created_at) values ($1, $2, $3)', [entry.id, entry, entry.createdAt])
}

/**
 * Atomically claims every due, still-scheduled notification job in one statement, so two scheduler processes
 * racing on the same tick cannot both send the same job -- the JSON backend cannot offer this across processes.
 */
export async function claimDueJobs(now = Date.now()) {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `update records set data = jsonb_set(data, '{status}', '"sending"'), updated_at = now()
       where collection = 'notificationJobs'
         and data->>'status' = 'scheduled'
         and (data->>'runAt' is null or (data->>'runAt')::timestamptz <= to_timestamp($1 / 1000.0))
       returning data`,
      [now],
    )
    return rows.map((row) => ({ ...row.data, status: 'sending' }))
  })
}
