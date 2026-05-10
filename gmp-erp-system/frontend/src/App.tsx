import { useEffect, useState } from 'react'
import { AppShell } from './components/layout/AppShell'
import { LoginPage } from './features/auth/LoginPage'
import { WarehouseDashboard } from './features/dashboard/WarehouseDashboard'
import { clearStoredToken, getStoredToken, storeToken } from './lib/auth'
import { login, logout, me } from './lib/api'
import type { CurrentUser, LoginRequest } from './types/auth'

export function App() {
  const [token, setToken] = useState<string | null>(getStoredToken)
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let ignore = false
    async function loadUser() {
      if (!token) return
      setIsLoading(true)
      try {
        const currentUser = await me(token)
        if (!ignore) setUser(currentUser)
      } catch (err) {
        clearStoredToken()
        if (!ignore) {
          setToken(null)
          setUser(null)
          setError(err instanceof Error ? err.message : 'Session expired')
        }
      } finally {
        if (!ignore) setIsLoading(false)
      }
    }
    void loadUser()
    return () => {
      ignore = true
    }
  }, [token])

  async function handleLogin(payload: LoginRequest) {
    setIsLoading(true)
    setError(null)
    try {
      const response = await login(payload)
      storeToken(response.access_token)
      setToken(response.access_token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleLogout() {
    if (token) {
      try {
        await logout(token)
      } catch {
        // Local logout still clears the browser session.
      }
    }
    clearStoredToken()
    setToken(null)
    setUser(null)
  }

  if (!token || !user) {
    return <LoginPage error={error} isLoading={isLoading} onLogin={handleLogin} />
  }

  return (
    <AppShell onLogout={handleLogout} user={user}>
      <WarehouseDashboard user={user} />
    </AppShell>
  )
}
