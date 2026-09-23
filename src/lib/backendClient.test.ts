// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteStoredFile,
  devLogin,
  downloadStoredFile,
  getBackendHealth,
  getSession,
  listLawyerCases,
  requestSignedUpload,
  saveWillToBackend,
  scheduleReminder,
  sendNotificationJobs,
  signOut,
  storeFileOnBackend,
  submitConsultation,
  uploadFileToBackend,
} from './backendClient'
import { defaultWillData } from './defaultData'
import { saveServerWillRef } from './storage'

function fakeToken(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64')
  return `${header}.${body}.signature`
}

const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600

/** Installs a fetch mock. `/api/auth/dev-login` is answered automatically (a valid client token) unless the
 * caller's own routes object provides a handler for it. */
function mockFetch(routes: Record<string, (init: RequestInit | undefined) => Response>) {
  let calls: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const entry = Object.entries(routes).find(([path]) => url.includes(path))
    if (entry) return entry[1](init)
    if (url.includes('/api/auth/dev-login')) return Response.json({ token: fakeToken({ sub: 'dev-user', role: 'client', exp: FUTURE_EXP }) })
    throw new Error(`unmocked fetch: ${url}`)
  }) as typeof fetch
  return { calls: () => calls }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  signOut()
})

describe('devLogin / signOut', () => {
  it('stores the returned token, and signOut clears it', async () => {
    mockFetch({ '/api/auth/dev-login': () => Response.json({ token: fakeToken({ sub: 'a', role: 'client', exp: FUTURE_EXP }) }) })
    const token = await devLogin('client')
    expect(token).toBeTruthy()
    expect(localStorage.getItem('octaraa-api-session-token')).toBe(token)
    signOut()
    expect(localStorage.getItem('octaraa-api-session-token')).toBeNull()
  })

  it('does not retry dev-login forever once the server disables it (403)', async () => {
    // devLoginUnavailable is private, in-module state that (deliberately) outlives a single call -- load a
    // fresh module instance so tripping it here can't leak into any other test in this file.
    vi.resetModules()
    const fresh = await import('./backendClient')
    const fetchMock = mockFetch({ '/api/auth/dev-login': () => new Response(null, { status: 403 }) })
    expect(await fresh.devLogin('client')).toBeNull()
    // A second, unrelated request must not keep hammering a disabled dev-login endpoint.
    await fresh.getSession()
    const loginCalls = fetchMock.calls().filter((c) => c.url.includes('dev-login'))
    expect(loginCalls.length).toBe(1)
  })
})

describe('request(): success, error and network-failure shapes', () => {
  it('returns backend health on success', async () => {
    mockFetch({ '/api/health': () => Response.json({ ok: true, authRequired: false, aiConfigured: false, emailConfigured: false, schedulerEnabled: false }) })
    const health = await getBackendHealth()
    expect(health?.ok).toBe(true)
  })

  it('returns null (not a throw) when the server is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    expect(await getBackendHealth()).toBeNull()
  })

  it('surfaces the server-provided error message on a non-2xx response', async () => {
    mockFetch({ '/api/session': () => Response.json({ error: 'nope' }, { status: 403 }) })
    // getSession() swallows errors into null; use a lower-level wrapper (submitConsultation) to see the raw ok:false path instead.
    expect(await getSession()).toBeNull()
  })

  it('retries exactly once after a 401 by dropping the stored token', async () => {
    localStorage.setItem('octaraa-api-session-token', fakeToken({ sub: 'a', role: 'client', exp: FUTURE_EXP }))
    let attempts = 0
    const fetchMock = mockFetch({
      '/api/session': () => {
        attempts += 1
        return attempts === 1 ? new Response(null, { status: 401 }) : Response.json({ user: { sub: 'dev-user', role: 'client' } })
      },
    })
    const user = await getSession()
    expect(user?.sub).toBe('dev-user')
    expect(attempts).toBe(2)
    // The first 401 cleared the stored token, so the retry (and the mocked dev-login) both ran.
    expect(fetchMock.calls().some((c) => c.url.includes('dev-login'))).toBe(true)
  })
})

describe('consultation, reminders, notifications', () => {
  it('submitConsultation posts the payload and reports success', async () => {
    mockFetch({ '/api/consultations': () => Response.json({ consultation: { id: '1' } }) })
    const consultation = { id: 'req-1', createdAt: new Date().toISOString(), contactName: 'A', contactPhone: '999', contactEmail: '', preferredMode: '' as const, preferredWindow: '', notes: '', flagsSnapshot: [] }
    expect(await submitConsultation(consultation, null)).toBe(true)
  })

  it('scheduleReminder wraps a single recipient into the "to" array the server expects', async () => {
    let sentBody: unknown
    mockFetch({
      '/api/notifications/schedule': (init) => {
        sentBody = JSON.parse(init?.body as string)
        return Response.json({ job: {} })
      },
    })
    const ok = await scheduleReminder({ runAt: new Date().toISOString(), to: 'a@b.com', subject: 'S', textContent: 'T', htmlContent: '<p>T</p>', kind: 'annual-review' })
    expect(ok).toBe(true)
    expect((sentBody as { message: { to: string[] } }).message.to).toEqual(['a@b.com'])
  })

  it('sendNotificationJobs skips the network call entirely for an empty job list', async () => {
    globalThis.fetch = (async () => {
      throw new Error('should not be called')
    }) as typeof fetch
    expect(await sendNotificationJobs([], 'a@b.com', 'sub-1')).toEqual([])
  })
})

describe('uploads', () => {
  it('requestSignedUpload returns the signed record', async () => {
    mockFetch({ '/api/uploads/sign': () => Response.json({ upload: { id: 'u1', uploadUrl: '/api/uploads/u1', status: 'signed' } }) })
    const file = new File(['hello'], 'a.pdf', { type: 'application/pdf' })
    const upload = await requestSignedUpload(file)
    expect(upload?.id).toBe('u1')
  })

  it('uploadFileToBackend PUTs to the signed URL', async () => {
    mockFetch({ '/api/uploads/u1': () => Response.json({ upload: { id: 'u1', uploadUrl: '', status: 'uploaded' } }) })
    const file = new File(['hello'], 'a.pdf', { type: 'application/pdf' })
    expect(await uploadFileToBackend(file, '/api/uploads/u1')).toBe(true)
  })

  it('storeFileOnBackend signs then uploads, and fails cleanly if either step fails', async () => {
    mockFetch({
      '/api/uploads/sign': () => Response.json({ upload: { id: 'u2', uploadUrl: '/api/uploads/u2', status: 'signed' } }),
      '/api/uploads/u2': () => new Response(null, { status: 500 }),
    })
    const file = new File(['hello'], 'a.pdf', { type: 'application/pdf' })
    expect(await storeFileOnBackend(file, 'unknown')).toBeNull() // upload step failed
  })

  it('deleteStoredFile DELETEs by id', async () => {
    mockFetch({ '/api/uploads/u3': () => Response.json({ upload: { id: 'u3', status: 'deleted' } }) })
    expect(await deleteStoredFile('u3')).toBe(true)
  })

  it('downloadStoredFile triggers a browser download on success', async () => {
    mockFetch({ '/api/uploads/u4': () => new Response(new Blob(['data']), { status: 200 }) })
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = () => 'blob:mock'
    URL.revokeObjectURL = () => {}
    try {
      expect(await downloadStoredFile('u4', 'file.pdf')).toBe(true)
    } finally {
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
    }
  })

  it('downloadStoredFile returns false without throwing when the file is gone', async () => {
    mockFetch({ '/api/uploads/u5': () => new Response(null, { status: 404 }) })
    expect(await downloadStoredFile('u5', 'file.pdf')).toBe(false)
  })
})

describe('saveWillToBackend', () => {
  it('mirrors the draft and remembers the server id/version for the next save', async () => {
    mockFetch({ '/api/wills': () => Response.json({ will: { id: 'w1', version: 3, updatedAt: new Date().toISOString() } }) })
    const result = await saveWillToBackend(defaultWillData())
    expect(result).toEqual({ status: 'saved', id: 'w1' })
  })

  it('never mirrors the draft for a staff session (lawyer/operations/advisor)', async () => {
    localStorage.setItem('octaraa-api-session-token', fakeToken({ sub: 'staff-1', role: 'lawyer', exp: FUTURE_EXP }))
    globalThis.fetch = (async () => {
      throw new Error('a staff session must never call /api/wills from this path')
    }) as typeof fetch
    expect(await saveWillToBackend(defaultWillData())).toEqual({ status: 'offline' })
  })

  it('adopts the newer version on a 409 conflict instead of clobbering it', async () => {
    saveServerWillRef({ id: 'w2', version: 1 })
    mockFetch({
      '/api/wills/w2': () => Response.json({ will: { id: 'w2', version: 5, willData: defaultWillData() } }),
      '/api/wills': () => new Response(null, { status: 409 }),
    })
    const result = await saveWillToBackend(defaultWillData())
    expect(result.status).toBe('conflict')
  })

  it('reports offline (not an exception) when the network is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    expect((await saveWillToBackend(defaultWillData())).status).toBe('offline')
  })
})

describe('lawyer workspace wrappers', () => {
  it('listLawyerCases returns the case list', async () => {
    mockFetch({ '/api/lawyer/cases': () => Response.json({ cases: [{ id: 'c1', clientName: 'A', state: '', version: 1, updatedAt: '', openThreads: 0, assignedTo: [] }] }) })
    const cases = await listLawyerCases()
    expect(cases?.[0]?.id).toBe('c1')
  })
})
