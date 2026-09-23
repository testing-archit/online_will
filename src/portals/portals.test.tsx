// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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

async function mount(initialPath: string, routes: { path: string; element: React.ReactElement }[]) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          {routes.map((route) => (
            <Route key={route.path} path={route.path} element={route.element} />
          ))}
        </Routes>
      </MemoryRouter>,
    ),
  )
  return { host, unmount: () => act(async () => root.unmount()) }
}

beforeEach(() => {
  getSession.mockReset()
  loginWithPassword.mockReset()
})

describe('RequireRole', () => {
  it('renders the protected content once a session with the matching role resolves', async () => {
    getSession.mockResolvedValue({ sub: 'u1', email: 'lawyer@x.com', role: 'lawyer' })
    const { host } = await mount('/lawyer', [
      { path: '/staff/login', element: <p>login page</p> },
      { path: '/lawyer', element: <RequireRole role="lawyer">{(user) => <p>Welcome {user.email}</p>}</RequireRole> },
    ])
    await act(async () => {})
    expect(host.textContent).toContain('Welcome lawyer@x.com')
  })

  it('redirects to /staff/login when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const { host } = await mount('/lawyer', [
      { path: '/staff/login', element: <p>login page</p> },
      { path: '/lawyer', element: <RequireRole role="lawyer">{() => <p>secret</p>}</RequireRole> },
    ])
    await act(async () => {})
    expect(host.textContent).toContain('login page')
  })

  it('redirects to /staff/login when the session role does not match', async () => {
    getSession.mockResolvedValue({ sub: 'u1', email: 'admin@x.com', role: 'admin' })
    const { host } = await mount('/lawyer', [
      { path: '/staff/login', element: <p>login page</p> },
      { path: '/lawyer', element: <RequireRole role="lawyer">{() => <p>secret</p>}</RequireRole> },
    ])
    await act(async () => {})
    expect(host.textContent).toContain('login page')
    expect(host.textContent).not.toContain('secret')
  })
})

describe('StaffLoginPage', () => {
  it('shows the server error message when login fails', async () => {
    loginWithPassword.mockResolvedValue({ ok: false, error: 'Incorrect email or password' })
    const { host } = await mount('/staff/login', [{ path: '/staff/login', element: <StaffLoginPage /> }])

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
  })

  it('navigates to the lawyer portal on a successful lawyer login', async () => {
    loginWithPassword.mockResolvedValue({ ok: true, role: 'lawyer', mustChangePassword: false })
    const { host } = await mount('/staff/login', [
      { path: '/staff/login', element: <StaffLoginPage /> },
      { path: '/lawyer', element: <p>lawyer home</p> },
    ])

    const form = host.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await act(async () => {})
    expect(host.textContent).toContain('lawyer home')
  })

  it('shows a "coming soon" message for a role with no portal yet, without navigating away', async () => {
    loginWithPassword.mockResolvedValue({ ok: true, role: 'operations', mustChangePassword: false })
    const { host } = await mount('/staff/login', [{ path: '/staff/login', element: <StaffLoginPage /> }])

    const form = host.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await act(async () => {})
    expect(host.textContent).toContain('coming soon')
  })
})
