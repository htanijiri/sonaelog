import { useMemo } from 'react'
import { Link } from 'react-router'
import { EXPIRY_STATUS_LABEL, type ExpiryStatus } from '../../domain/expiry'
import { LOCATION_KIND_LABEL, LOCATION_KIND_ORDER } from '../../domain/labels'
import { summarize } from '../../domain/summary'
import { useApp } from '../../state/AppContext'

const COUNTERS: ExpiryStatus[] = [
  'expired',
  'within_3_months',
  'within_1_year',
  'within_1_year_date_unknown',
  'unknown',
  'reported_ok_date_unknown',
]

const liters = (n: number) => `${n.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}L`

export function Home() {
  const { snapshot, today } = useApp()
  const s = useMemo(() => summarize(snapshot!, today), [snapshot, today])

  return (
    <div className="stack">
      <h1 className="page-title">ホーム</h1>

      <section aria-labelledby="h-expiry">
        <h2 id="h-expiry">期限</h2>
        <div className="counters">
          {COUNTERS.map((status) => (
            <Link key={status} to={`/items?expiry=${status}`} className={`counter counter-${status}`} data-testid={`counter-${status}`}>
              <span className="counter-num">{s.byExpiry[status]}</span>
              <span className="counter-label">{EXPIRY_STATUS_LABEL[status]}</span>
            </Link>
          ))}
          <Link to="/review" className="counter counter-review" data-testid="counter-review">
            <span className="counter-num">{s.needsReview}</span>
            <span className="counter-label">要確認</span>
          </Link>
        </div>
        <p className="muted small">数字は明細の数です（品物の個数ではありません）。</p>
      </section>

      <section aria-labelledby="h-kind">
        <h2 id="h-kind">区分</h2>
        <ul className="kind-list">
          {LOCATION_KIND_ORDER.filter((k) => k !== 'other' || s.byKind.other > 0).map((k) => (
            <li key={k}>
              <span>{LOCATION_KIND_LABEL[k]}</span>
              <span className="num">{s.byKind[k]} 明細</span>
            </li>
          ))}
        </ul>
        <p className="muted small">全部で {s.lotCount} 明細。</p>
      </section>

      <section aria-labelledby="h-water" className="card">
        <h2 id="h-water">水</h2>
        <dl className="facts" data-testid="water-summary">
          <dt>飲み水として数える分</dt>
          <dd>{liters(s.water.drinkingLiters)}</dd>
          <dt>うち期限が記録されていない分</dt>
          <dd>{liters(s.water.drinkingUndatedLiters)}</dd>
          <dt>生活用水候補（期限切れなど）</dt>
          <dd>{liters(s.water.nonDrinkingLiters)}</dd>
        </dl>
        <p className="muted small">
          容量が分かる明細だけを数えています。
          {s.water.unknownVolumeLots > 0 && `容量が分からない水が ${s.water.unknownVolumeLots} 明細あります。`}
        </p>
      </section>

      <section aria-labelledby="h-meals" className="card">
        <h2 id="h-meals">食事</h2>
        <dl className="facts" data-testid="meal-summary">
          <dt>食数（単位が「食」のもの）</dt>
          <dd>{s.meals.count}食</dd>
          {s.meals.expiredCount > 0 && (
            <>
              <dt>うち期限切れ（別に数えています）</dt>
              <dd>{s.meals.expiredCount}食</dd>
            </>
          )}
        </dl>
        <p className="muted small">食数に換算していない食品：{s.meals.notConvertedLots} 明細（セット商品の中身は合計に足していません）。</p>
      </section>

      <section aria-labelledby="h-toilet" className="card">
        <h2 id="h-toilet">非常用トイレ</h2>
        <dl className="facts" data-testid="toilet-summary">
          <dt>公称の使用回数（入力済みの分）</dt>
          <dd>{s.toilet.uses}回</dd>
        </dl>
        <p className="muted small">回数未入力：{s.toilet.missingLots} 明細（品名の「○回分」は自動では数えません。明細の編集で回数を入れてください）。</p>
      </section>
    </div>
  )
}
