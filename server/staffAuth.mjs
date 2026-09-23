import crypto from 'node:crypto'
import { httpError, ROLES } from './auth.mjs'
import { listRecords, upsertRecord } from './store.mjs'

// Staff accounts (lawyer, advisor, admin) live in the 'users' collection, reserved but unused by the JSON/Postgres
// stores until now. Clients never get an account row here -- their identity is just a JWT claim, minted freely
// like today, since the wizard has no login wall.
export const STAFF_ROLES = ['lawyer', 'advisor', 'admin']

const SCRYPT_KEYLEN = 64
const SALT_BYTES = 16

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)))
  })
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES)
  const derived = await scryptAsync(password, salt)
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`
}

export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split(':') : []
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, saltHex, hashHex] = parts
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scryptAsync(password, salt)
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase()
}

export async function findStaffByEmail(email) {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  const [match] = await listRecords('users', (user) => user.email === normalized)
  return match ?? null
}

export async function listStaffAccounts() {
  const users = await listRecords('users')
  return users.map(publicStaffView).sort((a, b) => a.email.localeCompare(b.email))
}

export function publicStaffView(user) {
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role, status: user.status, mustChangePassword: Boolean(user.mustChangePassword), createdAt: user.createdAt }
}

/** Admin-provisioned account creation. Rejects a duplicate email so two staff members never collide on sign-in. */
export async function createStaffAccount({ email, password, fullName, role }, actor) {
  const normalized = normalizeEmail(email)
  if (!normalized || !normalized.includes('@')) throw httpError(400, 'A valid email is required')
  if (!STAFF_ROLES.includes(role)) throw httpError(400, `role must be one of ${STAFF_ROLES.join(', ')}`)
  if (typeof password !== 'string' || password.length < 10) throw httpError(400, 'password must be at least 10 characters')
  if (typeof fullName !== 'string' || !fullName.trim()) throw httpError(400, 'fullName is required')
  if (await findStaffByEmail(normalized)) throw httpError(409, 'An account with this email already exists')

  const passwordHash = await hashPassword(password)
  const created = await upsertRecord(
    'users',
    { id: crypto.randomUUID(), email: normalized, passwordHash, fullName: fullName.trim().slice(0, 200), role, status: 'active', mustChangePassword: true },
    actor,
  )
  return publicStaffView(created)
}

export async function setStaffStatus(userId, status, actor) {
  if (!['active', 'disabled'].includes(status)) throw httpError(400, 'status must be "active" or "disabled"')
  const users = await listRecords('users', (user) => user.id === userId)
  if (!users.length) throw httpError(404, 'Not found')
  const updated = await upsertRecord('users', { id: userId, status }, actor, { skipOwnerCheck: true })
  return publicStaffView(updated)
}

export async function changeStaffPassword(userId, newPassword, actor) {
  if (typeof newPassword !== 'string' || newPassword.length < 10) throw httpError(400, 'password must be at least 10 characters')
  const passwordHash = await hashPassword(newPassword)
  const updated = await upsertRecord('users', { id: userId, passwordHash, mustChangePassword: false }, actor, { skipOwnerCheck: true })
  return publicStaffView(updated)
}

/** Bootstrap-only: never exposed over HTTP. Used by scripts/create-admin.mjs. */
export async function bootstrapStaffAccount({ email, password, fullName, role }) {
  if (!ROLES.includes(role)) throw new Error(`Unknown role "${role}"`)
  const normalized = normalizeEmail(email)
  if (await findStaffByEmail(normalized)) throw new Error(`An account with email ${normalized} already exists`)
  const passwordHash = await hashPassword(password)
  const created = await upsertRecord('users', { id: crypto.randomUUID(), email: normalized, passwordHash, fullName, role, status: 'active', mustChangePassword: false }, 'bootstrap')
  return publicStaffView(created)
}
