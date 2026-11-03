import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type Kind = 'success' | 'error' | 'warn'
interface Toast {
  id: number
  kind: Kind
  text: string
}

const Ctx = createContext<(kind: Kind, text: string) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const show = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'success' ? 3000 : 6000)
  }, [])
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'success' ? 'status' : 'alert'}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
