import { useState } from 'react'
import { LOCATION_KIND_LABEL, LOCATION_KIND_ORDER } from '../../domain/labels'
import type { LocationKind, StorageLocation } from '../../domain/types'
import { useChange } from '../useChange'
import { Dialog } from './Dialog'

/** 保管場所の追加・編集 */
export function LocationDialog({ location, onClose }: { location?: StorageLocation; onClose: () => void }) {
  const [name, setName] = useState(location?.display_name ?? '')
  const [kind, setKind] = useState<LocationKind>(location?.kind ?? 'long_term')
  const [note, setNote] = useState(location?.physical_note ?? '')
  const { run, busy } = useChange()
  const submit = async () => {
    const ok = await run(
      {
        type: 'upsert_location',
        location_id: location?.id,
        expected_updated_at: location?.updated_at,
        display_name: name,
        kind,
        physical_note: note || null,
      },
      location ? '保管場所を保存しました' : '保管場所を追加しました',
    )
    if (ok) onClose()
  }
  return (
    <Dialog title={location ? '保管場所を編集' : '保管場所を追加'} onClose={onClose}>
      <label className="field">
        <span>名前</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>区分</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as LocationKind)}>
          {LOCATION_KIND_ORDER.map((k) => (
            <option key={k} value={k}>
              {LOCATION_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>場所の説明（階・部屋・棚など。家族が実物を探せるように）</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          やめる
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
          保存する
        </button>
      </div>
    </Dialog>
  )
}
