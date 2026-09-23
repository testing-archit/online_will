// Picks the storage backend once, at startup: Postgres when DATABASE_URL is set (server/store.pg.mjs, tested
// against a real database), otherwise the zero-config local JSON file (server/store.json.mjs) nobody needs to
// set up just to run `npm run dev`. Every caller elsewhere in the server imports from here, never from either
// backend directly, so this is the only file that needs to know which one is active.
export { canRead, canWrite, isStaff, normalizeActor } from './storeAccess.mjs'

const backend = process.env.DATABASE_URL ? await import('./store.pg.mjs') : await import('./store.json.mjs')

export const upsertRecord = backend.upsertRecord
export const getRecord = backend.getRecord
export const getAuthorizedRecord = backend.getAuthorizedRecord
export const listRecords = backend.listRecords
export const listVersions = backend.listVersions
export const deleteRecord = backend.deleteRecord
export const appendAudit = backend.appendAudit
export const claimDueJobs = backend.claimDueJobs
