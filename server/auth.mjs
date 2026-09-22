import crypto from 'node:crypto'

const DEFAULT_DEV_SECRET = 'octaraa-local-dev-secret-change-me'
export const ROLES = ['client', 'lawyer', 'advisor', 'operations', 'executor', 'admin']

export function authRequired() {
  return process.env.AUTH_REQUIRED === 'true'
}

/** Refuse to boot in a configuration where tokens could be forged. */
export function assertAuthConfig() {
  const secret = process.env.API_SESSION_SECRET
  const weak = !secret || secret === DEFAULT_DEV_SECRET || secret.startsWith('replace_with') || secret.length < 32
  if ((authRequired() || process.env.NODE_ENV === 'production') && weak) {
    throw new Error('API_SESSION_SECRET must be set to a random value of at least 32 characters when AUTH_REQUIRED=true or NODE_ENV=production')
  }
}

export function createSessionToken({ userId, email, role = 'client', ttlSeconds = 60 * 60 * 8 }) {
  if (!ROLES.includes(role)) throw httpError(400, `Unknown role "${role}"`)
  const secret = getSecret()
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = toBase64Url(JSON.stringify({ sub: userId, email, role, iat: now, exp: now + ttlSeconds }))
  return `${header}.${payload}.${sign(`${header}.${payload}`, secret)}`
}

function verifyToken(token) {
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some((part) => !part)) throw httpError(401, 'Malformed token')
  const [header, payload, signature] = parts

  let parsedHeader
  let claims
  try {
    parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    throw httpError(401, 'Malformed token')
  }
  if (parsedHeader?.alg !== 'HS256') throw httpError(401, 'Unsupported token algorithm')

  const expected = Buffer.from(sign(`${header}.${payload}`, getSecret()))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw httpError(401, 'Invalid token signature')
  }
  if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) throw httpError(401, 'Token expired')
  if (!claims.sub || !ROLES.includes(claims.role)) throw httpError(401, 'Invalid token claims')
  return claims
}

export function authenticate(request) {
  const authorization = request.headers.authorization ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''

  if (!authRequired()) {
    // Local development: a valid token is honoured (so roles can be exercised),
    // otherwise fall back to a shared dev admin.
    if (token) {
      try {
        return verifyToken(token)
      } catch {
        /* fall through to the dev user */
      }
    }
    return { sub: 'local-dev-user', email: 'dev@octaraa.local', role: 'admin' }
  }

  if (!token) throw httpError(401, 'Missing bearer token')
  return verifyToken(token)
}

export function requireRole(user, allowedRoles) {
  if (!allowedRoles.includes(user.role)) {
    throw httpError(403, `Role ${user.role} cannot access this endpoint`)
  }
}

export function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function getSecret() {
  return process.env.API_SESSION_SECRET || DEFAULT_DEV_SECRET
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url')
}

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url')
}
