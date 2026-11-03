import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { EXPIRY_STATUS_LABEL, formatExpiry, type ExpiryStatus } from '../../domain/expiry'
import { label, USE_STATUS_LABEL } from '../../domain/labels'
import type { ItemRow } from '../../domain/search'
import type { UseStatus } from '../../domain/types'

/** 期限の状態。色だけに頼らず文字で出す */
export function ExpiryBadge({ status }: { status: ExpiryStatus }) {
  return <span className={`badge badge-exp-${status}`}>{EXPIRY_STATUS_LABEL[status]}</span>
}

export function UseStatusBadge({ status }: { status: UseStatus }) {
  if (status === 'stored') return null
  return <span className={`badge badge-use badge-use-${status}`}>{label(USE_STATUS_LABEL, status)}</span>
}

export function ReviewBadge() {
  return <span className="badge badge-review">要確認</span>
}

export function formatQuantity(q: number, unit: string): string {
  return `${Number.isInteger(q) ? q : q.toLocaleString('ja-JP')}${unit}`
}

/** 一覧のカード（スマホ）。同じ品名でも期限・場所が違えば別のカード */
export function LotCard({ row, showLocation = true }: { row: ItemRow; showLocation?: boolean }) {
  const { lot, location, expiry } = row
  const exp = formatExpiry(lot)
  return (
    <li>
      <Link to={`/items/${lot.id}`} className="card lot-card" data-testid="lot-card">
        <div className="lot-head">
          <span className="lot-name">{lot.name}</span>
          <span className="lot-qty">{formatQuantity(lot.quantity, lot.unit)}</span>
        </div>
        <div className="lot-meta">
          {showLocation && <span className="lot-loc">{location?.display_name ?? '（場所不明）'}</span>}
          <span className="lot-exp">
            期限：{exp.text}
            {exp.note && <span className="calc-mark">（計算）</span>}
          </span>
        </div>
        <div className="badges">
          <ExpiryBadge status={expiry.status} />
          <UseStatusBadge status={lot.use_status} />
          {lot.needs_review && <ReviewBadge />}
        </div>
      </Link>
    </li>
  )
}

/** 一覧の表（パソコン） */
export function LotTable({ rows, showLocation = true }: { rows: ItemRow[]; showLocation?: boolean }) {
  return (
    <table className="lot-table">
      <thead>
        <tr>
          <th>品名</th>
          <th>数量</th>
          {showLocation && <th>保管場所</th>}
          <th>期限</th>
          <th>状態</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ lot, location, expiry }) => {
          const exp = formatExpiry(lot)
          return (
            <tr key={lot.id} data-testid="lot-row">
              <td>
                <Link to={`/items/${lot.id}`}>{lot.name}</Link>
              </td>
              <td className="num">{formatQuantity(lot.quantity, lot.unit)}</td>
              {showLocation && <td>{location?.display_name}</td>}
              <td>
                {exp.text}
                {exp.note && <span className="calc-mark">（計算）</span>}
              </td>
              <td className="badges">
                <ExpiryBadge status={expiry.status} />
                <UseStatusBadge status={lot.use_status} />
                {lot.needs_review && <ReviewBadge />}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const WIDE = '(min-width: 768px)'

/** 画面幅が 768px 以上か（パソコンでは表、スマホではカードにする） */
function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches)
  useEffect(() => {
    const mq = window.matchMedia(WIDE)
    const update = () => setWide(mq.matches)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return wide
}

export function LotList({ rows, showLocation = true }: { rows: ItemRow[]; showLocation?: boolean }) {
  const wide = useWide()
  if (rows.length === 0) return <p className="muted">該当する明細はありません。</p>
  if (wide) return <LotTable rows={rows} showLocation={showLocation} />
  return (
    <ul className="lot-cards">
      {rows.map((row) => (
        <LotCard key={row.lot.id} row={row} showLocation={showLocation} />
      ))}
    </ul>
  )
}
