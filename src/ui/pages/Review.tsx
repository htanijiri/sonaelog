import { useMemo } from 'react'
import { filterItems } from '../../domain/search'
import { useApp } from '../../state/AppContext'
import { LotList } from '../components/LotParts'

export function Review() {
  const { snapshot, today } = useApp()
  const rows = useMemo(() => filterItems(snapshot!, { review: true, sort: 'location' }, today), [snapshot, today])
  return (
    <div className="stack">
      <h1 className="page-title">要確認</h1>
      <p className="muted">
        写真からの仮登録など、実物との照合が必要な明細です（{rows.length} 明細）。開いて品名・数量などを直し、「確認済みにする」を押してください。
      </p>
      <LotList rows={rows} />
    </div>
  )
}
