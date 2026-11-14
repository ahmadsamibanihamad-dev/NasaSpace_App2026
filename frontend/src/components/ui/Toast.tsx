import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

type Tone = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  tone: Tone
  text: string
}
const Ctx = createContext<(text: string, tone?: Tone) => void>(() => {})
let seq = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: string, tone: Tone = 'success') => {
    const id = seq++
    setItems((x) => [...x.slice(-3), { id, tone, text }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 3500)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-6 inset-x-0 z-[3000] flex flex-col items-center gap-2 pointer-events-none px-4" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="pointer-events-auto flex items-center gap-3 bg-surface border border-border rounded-pill ps-4 pe-2 h-11 text-label shadow-soft max-w-full">
            <Icon name={t.tone === 'success' ? 'check' : t.tone === 'error' ? 'alert' : 'info'} size={18} className={t.tone === 'error' ? 'text-critical' : 'text-green-600'} />
            <span className="truncate">{t.text}</span>
            <button aria-label="×" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} className="size-7 rounded-pill hover:bg-surface-muted flex items-center justify-center text-text-secondary">
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
