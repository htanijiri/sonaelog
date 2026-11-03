import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { todayInTokyo, type PlainDate } from '../domain/dates'
import type { Snapshot } from '../domain/types'
import { canEdit, snapshotOf, type AppController, type AppState } from './controller'

const Ctx = createContext<AppController | null>(null)

export function AppProvider({ controller, children }: { controller: AppController; children: ReactNode }) {
  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>
}

/** 日本時間の「今日」。アプリが前面に戻ったときに更新する（日付をまたいで開きっぱなしの場合に備える） */
function useToday(): PlainDate {
  const [today, setToday] = useState(() => todayInTokyo())
  useEffect(() => {
    const update = () => setToday((prev) => {
      const next = todayInTokyo()
      return prev.y === next.y && prev.m === next.m && prev.d === next.d ? prev : next
    })
    document.addEventListener('visibilitychange', update)
    const timer = setInterval(update, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', update)
      clearInterval(timer)
    }
  }, [])
  return today
}

export interface AppHook {
  ctl: AppController
  state: AppState
  snapshot: Snapshot | null
  editable: boolean
  today: PlainDate
}

export function useApp(): AppHook {
  const ctl = useContext(Ctx)
  if (!ctl) throw new Error('AppProvider がありません')
  const state = useSyncExternalStore(ctl.subscribe, ctl.getState)
  const today = useToday()
  return { ctl, state, snapshot: snapshotOf(state), editable: canEdit(state), today }
}
