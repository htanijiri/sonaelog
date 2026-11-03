import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { LOCATION_KIND_LABEL } from '../../domain/labels'
import { filterItems } from '../../domain/search'
import { useApp } from '../../state/AppContext'
import { BackButton } from '../components/BackButton'
import { Dialog } from '../components/Dialog'
import { LocationDialog } from '../components/LocationDialog'
import { LotList } from '../components/LotParts'
import { useChange } from '../useChange'

export function LocationDetail() {
  const { id } = useParams()
  const { snapshot, today, editable } = useApp()
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null)
  const { run, busy } = useChange()
  const navigate = useNavigate()
  const location = snapshot!.locations.find((l) => l.id === id)
  const rows = useMemo(() => filterItems(snapshot!, { location: id, sort: 'name' }, today), [snapshot, id, today])

  if (!location) return <p>保管場所が見つかりません。</p>

  const remove = async () => {
    const ok = await run({ type: 'archive_location', location_id: location.id, expected_updated_at: location.updated_at }, '保管場所を削除しました')
    if (ok) navigate('/locations', { replace: true })
  }

  return (
    <div className="stack">
      <BackButton fallback="/locations" />
      <h1 className="page-title">{location.display_name}</h1>
      <p className="muted">{LOCATION_KIND_LABEL[location.kind]}</p>
      <p>場所の説明：{location.physical_note || <span className="muted">未入力</span>}</p>
      {location.kind === 'pending_consumption' && (
        <p className="notice">ここは論理上の置き場所です。実際にどこに置いてあるかは未確認です。</p>
      )}
      <div className="action-grid">
        <button type="button" className="btn" disabled={!editable} onClick={() => setDialog('edit')}>
          名前・説明を編集
        </button>
        {editable && (
          <Link to={`/items/new?location=${location.id}`} className="btn">
            ＋ この場所に追加
          </Link>
        )}
        {rows.length === 0 && (
          <button type="button" className="btn btn-danger" disabled={!editable} onClick={() => setDialog('delete')}>
            この場所を削除
          </button>
        )}
      </div>
      <h2>中身（{rows.length} 明細）</h2>
      <LotList rows={rows} showLocation={false} />
      {dialog === 'edit' && <LocationDialog location={location} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && (
        <Dialog title="保管場所を削除" onClose={() => setDialog(null)}>
          <p>「{location.display_name}」を削除します。よろしいですか？</p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              やめる
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove()}>
              削除する
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
