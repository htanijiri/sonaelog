import { useState } from 'react'
import type { Change } from '../domain/changes'
import { useApp } from '../state/AppContext'
import { useToast } from './components/Toast'

const ERROR_TEXT: Record<string, string> = {
  offline: 'オフラインのため保存できませんでした',
  auth: '編集するには再ログインが必要です',
  conflict: 'ほかの家族が先に変更しました。最新を読み込んでからやり直してください',
  forbidden: 'この操作をする権限がありません',
}

/** 変更を送る。保存に成功したときだけ「保存しました」と出す */
export function useChange() {
  const { ctl } = useApp()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const run = async (change: Change, successText = '保存しました'): Promise<boolean> => {
    setBusy(true)
    try {
      const result = await ctl.applyChange(change)
      if (!result.ok) {
        toast('error', `保存できませんでした：${ERROR_TEXT[result.code] ?? result.message}`)
        if (result.code === 'conflict') void ctl.syncNow()
        return false
      }
      if (result.localUpdated) toast('success', successText)
      else toast('warn', `${successText}（クラウドには保存済み・この端末は未更新です。再同期してください）`)
      return true
    } finally {
      setBusy(false)
    }
  }
  return { run, busy }
}
