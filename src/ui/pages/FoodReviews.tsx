// 「味の感想」の一覧（spec 010）。在庫がなくなった品の感想も残る。
import { useState } from 'react'
import { Link } from 'react-router'
import { reviewRows, type ReviewRow } from '../../domain/foodReviews'
import { useApp } from '../../state/AppContext'
import { BackButton } from '../components/BackButton'
import { FoodReviewDialog, FoodReviewView } from '../components/FoodReviewParts'
import { formatQuantity } from '../components/LotParts'

export function FoodReviews() {
  const { snapshot, editable } = useApp()
  const rows = reviewRows(snapshot!)
  const [editing, setEditing] = useState<ReviewRow | null>(null)

  return (
    <div className="stack">
      <BackButton />
      <h1 className="page-title">味の感想</h1>
      <p className="muted small">食料品の感想を品名ごとにまとめています。食べ切って在庫がなくなった品も残ります。感想は食料品の明細の画面から書けます。</p>
      {!editable && <p className="muted small">オフライン、またはログインしていないため、感想は直せません（見ることはできます）。</p>}
      {rows.length === 0 ? (
        <p className="muted">まだ感想はありません。</p>
      ) : (
        <ul className="taste-list" data-testid="taste-list">
          {rows.map((row) => (
            <li key={row.review.id} className="card taste-row" data-testid="taste-row">
              <div className="taste-row-head">
                <span className="taste-row-name">{row.review.display_name}</span>
                <span className="small" data-testid="taste-stock">
                  {row.stock.length === 0 ? '在庫なし' : `在庫 ${row.stock.map((s) => formatQuantity(s.quantity, s.unit)).join('・')}`}
                </span>
              </div>
              <FoodReviewView review={row.review} />
              <div className="badges">
                {row.lots.length > 0 && (
                  <Link
                    to={row.lots.length === 1 ? `/items/${row.lots[0]!.id}` : `/items?${new URLSearchParams({ q: row.review.display_name, category: 'food' })}`}
                    className="btn btn-small"
                  >
                    明細を見る{row.lots.length > 1 && `（${row.lots.length}件）`}
                  </Link>
                )}
                <button type="button" className="btn btn-small" disabled={!editable} onClick={() => setEditing(row)}>
                  感想を直す
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <FoodReviewDialog name={editing.review.display_name} review={editing.review} onClose={() => setEditing(null)} />}
    </div>
  )
}
