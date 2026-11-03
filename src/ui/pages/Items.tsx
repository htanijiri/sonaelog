import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { EXPIRY_STATUS_LABEL, EXPIRY_STATUS_ORDER } from '../../domain/expiry'
import { CATEGORY_LABEL, USE_STATUS_LABEL } from '../../domain/labels'
import { filterFromParams, filterItems, paramsFromFilter, type ItemFilter, type SortKey } from '../../domain/search'
import { CATEGORIES, USE_STATUSES } from '../../domain/types'
import { useApp } from '../../state/AppContext'
import { LotList } from '../components/LotParts'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'expiry', label: '期限が近い順' },
  { key: 'name', label: '品名順' },
  { key: 'location', label: '保管場所順' },
  { key: 'updated', label: '最近更新した順' },
]

export function Items() {
  const { snapshot, today, editable } = useApp()
  const [params, setParams] = useSearchParams()
  const filter = filterFromParams(params)
  const rows = useMemo(() => filterItems(snapshot!, filter, today), [snapshot, params, today]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<ItemFilter>) => setParams(paramsFromFilter({ ...filter, ...patch }), { replace: true })
  const active = Boolean(filter.category || filter.location || filter.useStatus || filter.expiry || filter.review)
  const locations = [...snapshot!.locations].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">在庫</h1>
        {editable && (
          <Link to="/items/new" className="btn btn-primary">
            ＋ 追加
          </Link>
        )}
      </div>

      <div role="search" className="filters">
        <label className="field">
          <span className="sr-only">キーワード</span>
          <input
            type="search"
            placeholder="品名・メモで検索（例：単3）"
            value={filter.q ?? ''}
            onChange={(e) => update({ q: e.target.value || undefined })}
            aria-label="キーワード"
          />
        </label>
        <details className="filter-more" open={active}>
          <summary>絞り込み・並べ替え{active && '（絞り込み中）'}</summary>
          <div className="filter-grid">
            <label className="field">
              <span>カテゴリ</span>
              <select value={filter.category ?? ''} onChange={(e) => update({ category: (e.target.value || undefined) as ItemFilter['category'] })}>
                <option value="">すべて</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>保管場所</span>
              <select value={filter.location ?? ''} onChange={(e) => update({ location: e.target.value || undefined })}>
                <option value="">すべて</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>管理の状態</span>
              <select value={filter.useStatus ?? ''} onChange={(e) => update({ useStatus: (e.target.value || undefined) as ItemFilter['useStatus'] })}>
                <option value="">すべて</option>
                {USE_STATUSES.map((u) => (
                  <option key={u} value={u}>
                    {USE_STATUS_LABEL[u]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>期限の状態</span>
              <select value={filter.expiry ?? ''} onChange={(e) => update({ expiry: (e.target.value || undefined) as ItemFilter['expiry'] })}>
                <option value="">すべて</option>
                {EXPIRY_STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {EXPIRY_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>並べ替え</span>
              <select value={filter.sort ?? 'expiry'} onChange={(e) => update({ sort: e.target.value as SortKey })}>
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={Boolean(filter.review)} onChange={(e) => update({ review: e.target.checked || undefined })} />
              要確認だけ
            </label>
          </div>
          {active && (
            <button type="button" className="btn btn-small" onClick={() => setParams(paramsFromFilter({ q: filter.q, sort: filter.sort }), { replace: true })}>
              絞り込みを解除
            </button>
          )}
        </details>
      </div>

      <p className="muted small" data-testid="result-count">
        {rows.length} 明細
      </p>
      <LotList rows={rows} />
    </div>
  )
}
