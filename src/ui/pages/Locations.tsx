import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { expiryInfo } from '../../domain/expiry'
import { LOCATION_KIND_LABEL, LOCATION_KIND_ORDER } from '../../domain/labels'
import { useApp } from '../../state/AppContext'
import { LocationDialog } from '../components/LocationDialog'

export function Locations() {
  const { snapshot, today, editable } = useApp()
  const [adding, setAdding] = useState(false)
  const stats = useMemo(() => {
    const m = new Map<string, { lots: number; expired: number; soon: number }>()
    for (const lot of snapshot!.lots) {
      const s = m.get(lot.location_id) ?? { lots: 0, expired: 0, soon: 0 }
      const status = expiryInfo(lot, today).status
      s.lots += 1
      if (status === 'expired') s.expired += 1
      if (status === 'within_3_months' || status === 'within_1_year' || status === 'within_1_year_date_unknown') s.soon += 1
      m.set(lot.location_id, s)
    }
    return m
  }, [snapshot, today])

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">保管場所</h1>
        {editable && (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            ＋ 場所を追加
          </button>
        )}
      </div>
      {LOCATION_KIND_ORDER.map((kind) => {
        const locs = snapshot!.locations.filter((l) => l.kind === kind).sort((a, b) => a.sort_order - b.sort_order)
        if (locs.length === 0) return null
        return (
          <section key={kind} aria-labelledby={`h-${kind}`}>
            <h2 id={`h-${kind}`}>{LOCATION_KIND_LABEL[kind]}</h2>
            <ul className="loc-list">
              {locs.map((l) => {
                const s = stats.get(l.id) ?? { lots: 0, expired: 0, soon: 0 }
                return (
                  <li key={l.id}>
                    <Link to={`/locations/${l.id}`} className="card loc-card" data-testid="location-card">
                      <span className="loc-name">{l.display_name}</span>
                      <span className="loc-note">{l.physical_note || <span className="muted">場所の説明：未入力</span>}</span>
                      <span className="loc-stats">
                        <span data-testid="location-lot-count">{s.lots} 明細</span>
                        {s.expired > 0 && <span className="badge badge-exp-expired">期限切れ {s.expired}</span>}
                        {s.soon > 0 && <span className="badge badge-exp-within_1_year">期限間近 {s.soon}</span>}
                      </span>
                      {l.kind === 'pending_consumption' && <span className="muted small">論理上の置き場所です（実際の置き場所は未確認）</span>}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {adding && <LocationDialog onClose={() => setAdding(false)} />}
    </div>
  )
}
