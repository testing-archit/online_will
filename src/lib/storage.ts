import { defaultWillData } from './defaultData'
import type { ConsultationRequest, WillData } from './types'

const WILL_DATA_KEY = 'octaraa-will-draft-v1'
const CONSULTATION_KEY = 'octaraa-consultation-requests-v1'
const STEP_KEY = 'octaraa-will-step-v1'
const SERVER_WILL_KEY = 'octaraa-will-server-ref-v1'

// The draft lives in this browser and is mirrored to the backend (see
// backendClient.saveWillToBackend) so it is recoverable and reviewable by the
// assigned lawyer. The compliance audit diff is computed once, in WizardShell.

export function saveWillData(data: WillData) {
  try {
    localStorage.setItem(WILL_DATA_KEY, JSON.stringify(data))
  } catch {
    // storage unavailable (private mode, quota) — fail silently, in-memory state still works
  }
}

export function hasSavedWillData() {
  try {
    return localStorage.getItem(WILL_DATA_KEY) !== null
  } catch {
    return false
  }
}

export function loadWillData(): WillData | null {
  try {
    const raw = localStorage.getItem(WILL_DATA_KEY)
    return raw ? mergeWithDefaultWillData(JSON.parse(raw) as Partial<WillData>) : null
  } catch {
    return null
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Overlay a saved section on the defaults. Drafts written by older versions
 * may lack newer fields, or hold a wrong type after manual edits — array
 * fields are restored to the default when they are not arrays, so screens
 * never crash on `undefined.map`.
 */
function mergeSection<T extends object>(defaults: T, saved: unknown): T {
  if (!isPlainObject(saved)) return defaults
  const merged: Record<string, unknown> = { ...defaults, ...saved }
  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (Array.isArray(defaultValue) && !Array.isArray(merged[key])) merged[key] = defaultValue
    if (typeof defaultValue === 'string' && typeof merged[key] !== 'string') merged[key] = defaultValue
  }
  return merged as T
}

function mergeWithDefaultWillData(saved: Partial<WillData>): WillData {
  const defaults = defaultWillData()
  const root = isPlainObject(saved) ? saved : {}

  return {
    assistantIntake: mergeSection(defaults.assistantIntake, root.assistantIntake),
    documentVault: mergeSection(defaults.documentVault, root.documentVault),
    estateOs: mergeSection(defaults.estateOs, root.estateOs),
    personal: mergeSection(defaults.personal, root.personal),
    revocation: mergeSection(defaults.revocation, root.revocation),
    executorsGuardians: mergeSection(defaults.executorsGuardians, root.executorsGuardians),
    assets: mergeSection(defaults.assets, root.assets),
    insurance: mergeSection(defaults.insurance, root.insurance),
    distribution: mergeSection(defaults.distribution, root.distribution),
    funeral: mergeSection(defaults.funeral, root.funeral),
    execution: mergeSection(defaults.execution, root.execution),
  }
}

export function saveStepIndex(index: number) {
  try {
    localStorage.setItem(STEP_KEY, String(index))
  } catch {
    // ignore
  }
}

export function loadStepIndex(): number {
  try {
    const raw = localStorage.getItem(STEP_KEY)
    return raw ? Number.parseInt(raw, 10) || 0 : 0
  } catch {
    return 0
  }
}

export interface ServerWillRef {
  id: string
  version: number
}

export function loadServerWillRef(): ServerWillRef | null {
  try {
    const raw = localStorage.getItem(SERVER_WILL_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<ServerWillRef>) : null
    return parsed && typeof parsed.id === 'string' && Number.isInteger(parsed.version) ? (parsed as ServerWillRef) : null
  } catch {
    return null
  }
}

export function saveServerWillRef(ref: ServerWillRef | null) {
  try {
    if (ref) localStorage.setItem(SERVER_WILL_KEY, JSON.stringify(ref))
    else localStorage.removeItem(SERVER_WILL_KEY)
  } catch {
    // ignore
  }
}

/** Forget everything this browser holds about the Will: the answers, the step, the link to the server copy and any lawyer-consultation requests made from it. Sign-in is untouched. */
export function clearWillDraft() {
  try {
    localStorage.removeItem(WILL_DATA_KEY)
    localStorage.removeItem(STEP_KEY)
    localStorage.removeItem(SERVER_WILL_KEY)
    localStorage.removeItem(CONSULTATION_KEY)
  } catch {
    // ignore
  }
}

export function saveConsultationRequest(request: ConsultationRequest) {
  try {
    const existing = loadConsultationRequests()
    localStorage.setItem(CONSULTATION_KEY, JSON.stringify([...existing, request]))
  } catch {
    // ignore
  }
}

export function loadConsultationRequests(): ConsultationRequest[] {
  try {
    const raw = localStorage.getItem(CONSULTATION_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as ConsultationRequest[]) : []
  } catch {
    return []
  }
}
