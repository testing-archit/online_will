// Ownership/role rules shared by every storage backend (JSON file today, Postgres when DATABASE_URL is set).

const STAFF_ROLES = new Set(['admin', 'operations'])
const ASSIGNABLE_ROLES = new Set(['lawyer', 'advisor'])

export function normalizeActor(actor) {
  if (!actor) return { sub: 'anonymous', role: 'anonymous' }
  if (typeof actor === 'string') return { sub: actor, role: 'system' }
  return { sub: actor.sub ?? 'anonymous', email: actor.email, role: actor.role ?? 'client' }
}

export function isStaff(actor) {
  const { role } = normalizeActor(actor)
  return role === 'system' || STAFF_ROLES.has(role)
}

export function canRead(record, actor) {
  if (!record) return false
  const { sub, role } = normalizeActor(actor)
  if (isStaff(actor)) return true
  if (record.ownerId === sub) return true
  if (Array.isArray(record.sharedWith) && record.sharedWith.includes(sub)) return true
  return ASSIGNABLE_ROLES.has(role) && Array.isArray(record.assignedTo) && record.assignedTo.includes(sub)
}

export function canWrite(record, actor) {
  if (!record) return true
  const { sub } = normalizeActor(actor)
  return isStaff(actor) || record.ownerId === sub
}
