// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '../lib/backendClient'
import { RequireRole } from './RequireRole'
import { StaffLoginPage } from './StaffLoginPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const getSession = vi.fn<() => Promise<SessionUser | null>>()
const loginWithPassword = vi.fn()

vi.mock('../lib/backendClient', () => ({
  getSession: (...args: unknown[]) => getSession(...(args as [])),
  loginWithPassword: (...args: unknown[]) => loginWithPassword(...args),
}))

// next/navigation needs a real App Router context to work, which a plain jsdom render doesn't provide -- mocked
// here instead, the same way react-router-dom's MemoryRouter used to be, so RequireRole/StaffLoginPage's calls to
// router.replace()/usePathname()/useSearchParams() can be driven and asserted directly.
let currentPathname = '/lawyer'
let currentSearchParams = new URLSearchParams()
const routerReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: routerReplace }),
  usePathname: () => currentPathname,
  useSearchParams: () => currentSearchParams,
  useParams: () => ({}),
}))

async function mount(element: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(element))
  return { host, unmount: () => act(async () => root.unmount()) }
}

beforeEach(() => {
  document.body.innerHTML = ''
  getSession.mockReset()
  loginWithPassword.mockReset()
  routerReplace.mockReset()
  currentPathname = '/lawyer'
  currentSearchParams = new URLSearchParams()
})

describe('RequireRole', () => {
  it('renders the protected content once a session with the matching role resolves', async () => {
    getSession.mockResolvedValue({ sub: 'u1', email: 'lawyer@x.com', role: 'lawyer' })
    const { host } = await mount(<RequireRole role="lawyer">{(user) => <p>Welcome {user.email}</p>}</RequireRole>)
    await act(async () => {})
    expect(host.textContent).toContain('Welcome lawyer@x.com')
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('redirects to /staff/login when there is no session', async () => {
    getSession.mockResolvedValue(null)
    await mount(<RequireRole role="lawyer">{() => <p>secret</p>}</RequireRole>)
    await act(async () => {})
    expect(routerReplace).toHaveBeenCalledWith('/staff/login?from=%2Flawyer')
  })

  it('redirects to /staff/login when the session role does not match', async () => {
    getSession.mockResolvedValue({ sub: 'u1', email: 'admin@x.com', role: 'admin' })
    const { host } = await mount(<RequireRole role="lawyer">{() => <p>secret</p>}</RequireRole>)
    await act(async () => {})
    expect(host.textContent).not.toContain('secret')
    expect(routerReplace).toHaveBeenCalledWith('/staff/login?from=%2Flawyer')
  })
})

describe('StaffLoginPage', () => {
  it('shows the server error message when login fails', async () => {
    loginWithPassword.mockResolvedValue({ ok: false, error: 'Incorrect email or password' })
    const { host } = await mount(<StaffLoginPage />)

    const form = host.querySelector('form')!
    const [emailInput, passwordInput] = host.querySelectorAll('input')
    await act(async () => {
      emailInput.value = 'lawyer@x.com'
      emailInput.dispatchEvent(new Event('input', { bubbles: true }))
      passwordInput.value = 'wrong'
      passwordInput.dispatchEvent(new Event('input', { bubbles: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await act(async () => {})
    expect(host.textContent).toContain('Incorrect email or password')
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('navigates to the lawyer portal on a successful lawyer login', async () => {
    loginWithPassword.mockResolvedValue({ ok: true, role: 'lawyer', mustChangePassword: false })
    const { host } = await mount(<StaffLoginPage />)

    const form = host.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await act(async () => {})
    expect(routerReplace).toHaveBeenCalledWith('/lawyer')
  })

  it('honors a ?from= redirect target that stays within the signed-in role\'s portal', async () => {
    currentSearchParams = new URLSearchParams('from=/lawyer/cases/abc123')
    loginWithPassword.mockResolvedValue({ ok: true, role: 'lawyer', mustChangePassword: false })
    const { host } = await mount(<StaffLoginPage />)
    const form = host.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await act(async () => {})
    expect(routerReplace).toHaveBeenCalledWith('/lawyer/cases/abc123')
  })

  it('shows a "coming soon" message for a role with no portal yet, without navigating away', async () => {
    loginWithPassword.mockResolvedValue({ ok: true, role: 'operations', mustChangePassword: false })
    const { host } = await mount(<StaffLoginPage />)

    const form = host.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await act(async () => {})
    expect(host.textContent).toContain('coming soon')
    expect(routerReplace).not.toHaveBeenCalled()
  })
})
