import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, getToken, setToken } from '../lib/api'
import type { AuthResponse, User } from '../lib/types'

interface AuthCtx {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  register: (full_name: string, email: string, password: string) => Promise<User>
  logout: () => void
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState<boolean>(!!getToken())
  const qc = useQueryClient()

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      setUser(await api<User>('/auth/me'))
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const onLogout = () => setUser(null)
    window.addEventListener('ardna:logout', onLogout)
    return () => window.removeEventListener('ardna:logout', onLogout)
  }, [refresh])

  const login = async (email: string, password: string) => {
    const r = await api<AuthResponse>('/auth/login', { body: { email, password } })
    setToken(r.access_token)
    setUser(r.user)
    return r.user
  }
  const register = async (full_name: string, email: string, password: string) => {
    const r = await api<AuthResponse>('/auth/register', { body: { full_name, email, password } })
    setToken(r.access_token)
    setUser(r.user)
    return r.user
  }
  const logout = () => {
    setToken(null)
    setUser(null)
    qc.clear()
  }

  return <Ctx.Provider value={{ user, loading, login, register, logout, refresh }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside provider')
  return c
}
