// 食料品の味の感想（spec 010）の表示と編集。感想は品名ごとに1つで、家庭で共有する。
import { useState } from 'react'
import { formatDateTime } from '../../domain/dates'
import { FOOD_RATING_LABEL } from '../../domain/foodReviews'
import { FOOD_RATINGS, FOOD_REVIEW_COMMENT_MAX, type FoodRating, type FoodReview } from '../../domain/types'
import { useChange } from '../useChange'
import { Dialog } from './Dialog'

const RATING_ICON: Record<FoodRating, string> = { again: '◎', ok: '○', never: '×' }

/** 評価の小さな表示。色だけに頼らず記号と文字で出す */
export function FoodRatingBadge({ rating }: { rating: FoodRating | null }) {
  if (!rating) return null
  return (
    <span className={`badge badge-taste badge-taste-${rating}`} data-testid="taste-badge">
      <span aria-hidden="true">{RATING_ICON[rating]}</span>
      {FOOD_RATING_LABEL[rating]}
    </span>
  )
}

/** 感想の中身（評価・コメント・最終更新）。感想がなければ何も出さない */
export function FoodReviewView({ review }: { review: FoodReview }) {
  return (
    <div className="taste-view">
      <div className="badges">
        {review.rating ? <FoodRatingBadge rating={review.rating} /> : <span className="muted small">評価なし</span>}
      </div>
      {review.comment && <p className="pre taste-comment">{review.comment}</p>}
      <p className="muted small">最終更新：{formatDateTime(review.updated_at)}</p>
    </div>
  )
}

/** 明細の画面などに置く「味の感想」の欄 */
export function FoodReviewSection({ name, review, editable }: { name: string; review: FoodReview | undefined; editable: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="card taste-section" aria-labelledby="taste-title" data-testid="taste-section">
      <h2 id="taste-title" className="section-title">
        味の感想
      </h2>
      <p className="muted small">同じ品名の明細すべてに共通です。食べ切っても残ります。</p>
      {review ? <FoodReviewView review={review} /> : <p className="muted">まだ感想はありません。</p>}
      <button type="button" className="btn" disabled={!editable} onClick={() => setOpen(true)}>
        {review ? '感想を直す' : '感想を書く'}
      </button>
      {!editable && <p className="muted small">オフライン、またはログインしていないため書けません。</p>}
      {open && <FoodReviewDialog name={name} review={review} onClose={() => setOpen(false)} />}
    </section>
  )
}

export function FoodReviewDialog({ name, review, onClose }: { name: string; review: FoodReview | undefined; onClose: () => void }) {
  const [rating, setRating] = useState<FoodRating | null>(review?.rating ?? null)
  const [comment, setComment] = useState(review?.comment ?? '')
  const { run, busy } = useChange()
  const length = [...comment.trim()].length
  const tooLong = length > FOOD_REVIEW_COMMENT_MAX
  const empty = rating === null && comment.trim() === ''

  const send = async (r: FoodRating | null, c: string, text: string) => {
    const ok = await run({ type: 'set_food_review', name, rating: r, comment: c, expected_updated_at: review?.updated_at ?? null }, text)
    if (ok) onClose()
  }

  return (
    <Dialog title="味の感想" onClose={onClose}>
      <p className="muted small">{name}</p>
      <fieldset className="radios">
        <legend>評価</legend>
        {FOOD_RATINGS.map((r) => (
          <label key={r} className="check">
            <input type="radio" name="taste-rating" checked={rating === r} onChange={() => setRating(r)} />
            {RATING_ICON[r]} {FOOD_RATING_LABEL[r]}
          </label>
        ))}
        <label className="check">
          <input type="radio" name="taste-rating" checked={rating === null} onChange={() => setRating(null)} />
          付けない
        </label>
      </fieldset>
      <label className="field">
        <span>
          コメント（{length}/{FOOD_REVIEW_COMMENT_MAX}文字）
        </span>
        <textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="例：子どもも完食。お湯で15分" />
      </label>
      {tooLong && <p className="field-error">コメントは{FOOD_REVIEW_COMMENT_MAX}文字までにしてください</p>}
      {empty && !review && <p className="muted small">評価かコメントのどちらかを入れてください。</p>}
      <div className="dialog-actions">
        {review && (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void send(null, '', '感想を消しました')}>
            感想を消す
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          やめる
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || tooLong || empty} onClick={() => void send(rating, comment, '感想を保存しました')}>
          保存する
        </button>
      </div>
    </Dialog>
  )
}
