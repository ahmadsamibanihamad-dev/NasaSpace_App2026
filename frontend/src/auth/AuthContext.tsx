import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as repo from '../lib/data/repo'
import type { User } from '../lib/types'

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
  const [loading, setLoading] = useState<boolean>(!!repo.currentUserId())
  const qc = useQueryClient()

  const refresh = useCallback(async () => {
    try {
      setUser(await repo.me())
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const login = async (email: string, password: string) => {
    const u = await repo.login(email, password)
    qc.clear()
    setUser(u)
    return u
  }
  const register = async (full_name: string, email: string, password: string) => {
    const u = await repo.register(full_name, email, password)
    qc.clear()
    setUser(u)
    return u
  }
  const logout = () => {
    repo.logout()
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
