import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useFarms } from '../hooks/queries'
import type { Farm } from '../lib/types'

interface FarmCtx {
  farms: Farm[]
  farm: Farm | null
  setFarmId: (id: string) => void
  isLoading: boolean
  error: unknown
  refetch: () => void
}
const Ctx = createContext<FarmCtx | null>(null)
const KEY = 'ardna.farm'

export function FarmProvider({ children }: { children: ReactNode }) {
  const q = useFarms()
  const [farmId, setFarmIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY)
    } catch {
      return null
    }
  })
  const farms = useMemo(() => q.data ?? [], [q.data])
  const farm = farms.find((f) => f.id === farmId) ?? farms[0] ?? null
  useEffect(() => {
    if (farm && farm.id !== farmId) setFarmIdState(farm.id)
  }, [farm, farmId])
  const setFarmId = (id: string) => {
    setFarmIdState(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* ignore */
    }
  }
  return <Ctx.Provider value={{ farms, farm, setFarmId, isLoading: q.isLoading, error: q.error, refetch: q.refetch }}>{children}</Ctx.Provider>
}

export function useFarmCtx() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useFarmCtx outside provider')
  return c
}
