import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { Disposition } from '../../domain/changes'
import { formatDateTime, formatDateValue } from '../../domain/dates'
import { expiryInfo, formatExpiry } from '../../domain/expiry'
import {
  CATEGORY_LABEL,
  EXPIRY_CHECK_LABEL,
  EXPIRY_KIND_LABEL,
  label,
  SOURCE_LABEL,
  USE_STATUS_LABEL,
} from '../../domain/labels'
import { monthsLabel } from '../../domain/shelfLifePresets'
import type { InventoryLot, LotInput } from '../../domain/types'
import { useApp } from '../../state/AppContext'
import { Dialog } from '../components/Dialog'
import { ExpiryBadge, formatQuantity, ReviewBadge, UseStatusBadge } from '../components/LotParts'
import { BackButton } from '../components/BackButton'
import { useChange } from '../useChange'

type DialogKind = 'move' | 'consume' | 'split' | 'review' | null

export function ItemDetail() {
  const { id } = useParams()
  const { snapshot, today, editable } = useApp()
  const lot = snapshot!.lots.find((l) => l.id === id)
  const [dialog, setDialog] = useState<DialogKind>(null)

  if (!lot) {
    return (
      <div className="stack">
        <p>この明細は見つかりません（消費・廃棄で一覧から外れたか、ほかの家族が変更した可能性があります）。</p>
        <Link to="/items">在庫一覧へ</Link>
      </div>
    )
  }
  const location = snapshot!.locations.find((l) => l.id === lot.location_id)
  const info = expiryInfo(lot, today)
  const exp = formatExpiry(lot)

  return (
    <div className="stack">
      <BackButton />
      <h1 className="page-title">{lot.name}</h1>
      <div className="badges">
        <ExpiryBadge status={info.status} />
        <UseStatusBadge status={lot.use_status} />
        {lot.needs_review && <ReviewBadge />}
      </div>

      <dl className="facts detail" data-testid="lot-detail">
        <dt>数量</dt>
        <dd className="big">{formatQuantity(lot.quantity, lot.unit)}</dd>
        <dt>保管場所</dt>
        <dd>
          {location ? <Link to={`/locations/${location.id}`}>{location.display_name}</Link> : '（不明）'}
          {location?.kind === 'pending_consumption' && <span className="muted small">（実際の置き場所は未確認）</span>}
        </dd>
        <dt>{EXPIRY_KIND_LABEL[lot.expiry_kind ?? 'none']}</dt>
        <dd>
          {exp.text}
          {exp.note && <span className="muted small">（{exp.note}）</span>}
          {info.daysLeft !== null && info.daysLeft >= 0 && <span className="muted small">（あと{info.daysLeft}日）</span>}
        </dd>
        {lot.manufactured_value && lot.manufactured_precision && (
          <>
            <dt>製造年月</dt>
            <dd>
              {formatDateValue(lot.manufactured_value, lot.manufactured_precision)}
              {lot.shelf_life_months && `（製造から${monthsLabel(lot.shelf_life_months)}）`}
            </dd>
          </>
        )}
        <dt>期限の確認状況</dt>
        <dd>{label(EXPIRY_CHECK_LABEL, lot.expiry_check)}</dd>
        <dt>管理の状態</dt>
        <dd>{label(USE_STATUS_LABEL, lot.use_status)}</dd>
        <dt>カテゴリ</dt>
        <dd>{label(CATEGORY_LABEL, lot.category)}</dd>
        {lot.liters_per_unit !== null && (
          <>
            <dt>1{lot.unit}あたり</dt>
            <dd>{lot.liters_per_unit}L</dd>
          </>
        )}
        {lot.uses_per_unit !== null && (
          <>
            <dt>公称の使用回数</dt>
            <dd>1{lot.unit}あたり{lot.uses_per_unit}回</dd>
          </>
        )}
        <dt>情報の出どころ</dt>
        <dd>{label(SOURCE_LABEL, lot.source)}</dd>
        <dt>要確認</dt>
        <dd>{lot.needs_review ? 'はい' : 'いいえ'}</dd>
        <dt>メモ</dt>
        <dd className="pre">{lot.notes || '—'}</dd>
        {lot.components && lot.components.length > 0 && (
          <>
            <dt>セットの中身（参考）</dt>
            <dd>
              <ul className="plain">
                {lot.components.map((c) => (
                  <li key={c.name}>
                    {c.name}：1{lot.unit}あたり{c.quantity_per_box}
                    {c.unit}
                  </li>
                ))}
              </ul>
              <span className="muted small">
                {lot.quantity}
                {lot.unit}で計{lot.components.reduce((n, c) => n + c.quantity_per_box, 0) * lot.quantity}
                {lot.components[0]?.unit}（参考。合計には足していません）
              </span>
            </dd>
          </>
        )}
        <dt>最終更新</dt>
        <dd>{formatDateTime(lot.updated_at)}</dd>
      </dl>

      <section aria-label="操作" className="actions">
        {!editable && <p className="muted">オフライン、またはログインしていないため編集できません。</p>}
        <QuantityEditor lot={lot} disabled={!editable} />
        <div className="action-grid">
          <button type="button" className="btn" disabled={!editable} onClick={() => setDialog('consume')}>
            消費・廃棄
          </button>
          <button type="button" className="btn" disabled={!editable} onClick={() => setDialog('move')}>
            保管場所を移す
          </button>
          <Link to={`/items/${lot.id}/edit`} className={`btn ${editable ? '' : 'is-disabled'}`} aria-disabled={!editable} onClick={(e) => !editable && e.preventDefault()}>
            編集（期限・メモなど）
          </Link>
          <Link to={`/items/new?replace=${lot.id}`} className={`btn ${editable ? '' : 'is-disabled'}`} aria-disabled={!editable} onClick={(e) => !editable && e.preventDefault()}>
            買い替え
          </Link>
          <button type="button" className="btn" disabled={!editable} onClick={() => setDialog('split')}>
            分ける
          </button>
          {lot.needs_review && (
            <button type="button" className="btn btn-primary" disabled={!editable} onClick={() => setDialog('review')}>
              確認済みにする
            </button>
          )}
        </div>
      </section>

      {dialog === 'consume' && <ConsumeDialog lot={lot} onClose={() => setDialog(null)} />}
      {dialog === 'move' && <MoveDialog lot={lot} onClose={() => setDialog(null)} />}
      {dialog === 'split' && <SplitDialog lot={lot} onClose={() => setDialog(null)} />}
      {dialog === 'review' && <ReviewDialog lot={lot} onClose={() => setDialog(null)} />}
    </div>
  )
}

function QuantityEditor({ lot, disabled }: { lot: InventoryLot; disabled: boolean }) {
  const [value, setValue] = useState(String(lot.quantity))
  const [prevQuantity, setPrevQuantity] = useState(lot.quantity)
  const { run, busy } = useChange()
  // 同期で数量が変わったら入力欄も合わせる
  if (prevQuantity !== lot.quantity) {
    setPrevQuantity(lot.quantity)
    setValue(String(lot.quantity))
  }
  const n = Number(value)
  const valid = value.trim() !== '' && Number.isFinite(n) && n > 0
  const save = (q: number) =>
    run({ type: 'set_quantity', lot_id: lot.id, expected_updated_at: lot.updated_at, quantity: q }, `数量を${formatQuantity(q, lot.unit)}にしました`)

  return (
    <div className="qty-editor" role="group" aria-label="数量の変更">
      <button type="button" className="btn btn-round" aria-label="1つ減らす" disabled={disabled || busy || lot.quantity <= 1} onClick={() => void save(lot.quantity - 1)}>
        −
      </button>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="数量"
        disabled={disabled || busy}
      />
      <span>{lot.unit}</span>
      <button type="button" className="btn btn-round" aria-label="1つ増やす" disabled={disabled || busy} onClick={() => void save(lot.quantity + 1)}>
        ＋
      </button>
      <button type="button" className="btn" disabled={disabled || busy || !valid || n === lot.quantity} onClick={() => void save(n)}>
        数量を保存
      </button>
      {!valid && value.trim() !== '' && <p className="field-error">0 より大きい数を入れてください（0 にするときは「消費・廃棄」）</p>}
    </div>
  )
}

function ConsumeDialog({ lot, onClose }: { lot: InventoryLot; onClose: () => void }) {
  const [quantity, setQuantity] = useState(String(lot.quantity))
  const [disposition, setDisposition] = useState<Disposition>('consumed')
  const { run, busy } = useChange()
  const navigate = useNavigate()
  const n = Number(quantity)
  const valid = Number.isFinite(n) && n > 0 && n <= lot.quantity
  const remaining = lot.quantity - n

  const submit = async () => {
    const ok = await run(
      { type: 'consume', lot_id: lot.id, expected_updated_at: lot.updated_at, quantity: n, disposition },
      disposition === 'consumed' ? `${formatQuantity(n, lot.unit)}を消費しました` : `${formatQuantity(n, lot.unit)}を廃棄しました`,
    )
    if (ok) {
      onClose()
      if (remaining === 0) navigate('/items', { replace: true })
    }
  }
  return (
    <Dialog title="消費・廃棄" onClose={onClose}>
      <fieldset className="radios">
        <legend>どうしましたか</legend>
        <label className="check">
          <input type="radio" name="disp" checked={disposition === 'consumed'} onChange={() => setDisposition('consumed')} />
          使った（消費）
        </label>
        <label className="check">
          <input type="radio" name="disp" checked={disposition === 'discarded'} onChange={() => setDisposition('discarded')} />
          捨てた（廃棄）
        </label>
      </fieldset>
      <label className="field">
        <span>数（今 {formatQuantity(lot.quantity, lot.unit)}）</span>
        <input type="number" inputMode="decimal" min={0} step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </label>
      {valid && remaining === 0 && <p className="muted">残りが 0 になるので、通常の一覧から消えます（記録は残ります）。</p>}
      {!valid && <p className="field-error">1 以上、今の数量以下にしてください</p>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          やめる
        </button>
        <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={() => void submit()}>
          {disposition === 'consumed' ? '消費する' : '廃棄する'}
        </button>
      </div>
    </Dialog>
  )
}

function MoveDialog({ lot, onClose }: { lot: InventoryLot; onClose: () => void }) {
  const { snapshot } = useApp()
  const others = snapshot!.locations.filter((l) => l.id !== lot.location_id).sort((a, b) => a.sort_order - b.sort_order)
  const [to, setTo] = useState(others[0]?.id ?? '')
  const [partial, setPartial] = useState(false)
  const [quantity, setQuantity] = useState('1')
  const { run, busy } = useChange()
  const n = Number(quantity)
  const valid = Boolean(to) && (!partial || (Number.isFinite(n) && n > 0 && n < lot.quantity))

  const submit = async () => {
    const ok = await run(
      { type: 'move_lot', lot_id: lot.id, expected_updated_at: lot.updated_at, to_location_id: to, ...(partial ? { quantity: n } : {}) },
      '保管場所を移しました',
    )
    if (ok) onClose()
  }
  return (
    <Dialog title="保管場所を移す" onClose={onClose}>
      <label className="field">
        <span>移す先</span>
        <select value={to} onChange={(e) => setTo(e.target.value)}>
          {others.map((l) => (
            <option key={l.id} value={l.id}>
              {l.display_name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="radios">
        <legend>移す数</legend>
        <label className="check">
          <input type="radio" name="part" checked={!partial} onChange={() => setPartial(false)} />
          全部（{formatQuantity(lot.quantity, lot.unit)}）
        </label>
        <label className="check">
          <input type="radio" name="part" checked={partial} onChange={() => setPartial(true)} disabled={lot.quantity <= 1} />
          一部だけ（移した分は別の明細になります）
        </label>
      </fieldset>
      {partial && (
        <label className="field">
          <span>移す数</span>
          <input type="number" inputMode="decimal" min={0} step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </label>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          やめる
        </button>
        <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={() => void submit()}>
          移す
        </button>
      </div>
    </Dialog>
  )
}

interface ChildRow {
  name: string
  quantity: string
  unit: string
}

function SplitDialog({ lot, onClose }: { lot: InventoryLot; onClose: () => void }) {
  const [decrease, setDecrease] = useState('1')
  const [children, setChildren] = useState<ChildRow[]>(
    lot.components?.length
      ? lot.components.map((c) => ({ name: c.name, quantity: String(c.quantity_per_box), unit: c.unit }))
      : [{ name: lot.name, quantity: '1', unit: lot.unit }],
  )
  const [confirming, setConfirming] = useState(false)
  const { run, busy } = useChange()
  const d = Number(decrease)
  const rows = children.filter((c) => c.name.trim() && Number(c.quantity) > 0 && c.unit.trim())
  const valid = Number.isFinite(d) && d > 0 && d <= lot.quantity && rows.length > 0

  const submit = async () => {
    const { id: _i, seed_code: _s, created_at: _c, updated_at: _u, ...base } = lot
    const inputs: LotInput[] = rows.map((c) => ({
      ...base,
      name: c.name.trim(),
      quantity: Number(c.quantity),
      unit: c.unit.trim(),
      components: null,
      source: 'user',
      needs_review: false,
      notes: `「${lot.name}」から分けた`,
    }))
    const ok = await run({ type: 'split_lot', lot_id: lot.id, expected_updated_at: lot.updated_at, decrease: d, children: inputs }, '明細を分けました')
    if (ok) onClose()
  }
  const set = (i: number, patch: Partial<ChildRow>) => setChildren((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  return (
    <Dialog title="分ける" onClose={onClose}>
      <p className="muted small">セット商品を開けたときなどに使います。元の明細の数を減らし、中身を別の明細として登録します。期限・保管場所は元の明細と同じになります（あとで編集できます）。</p>
      <label className="field">
        <span>元の明細から減らす数（今 {formatQuantity(lot.quantity, lot.unit)}）</span>
        <input type="number" inputMode="decimal" min={0} step="any" value={decrease} onChange={(e) => setDecrease(e.target.value)} />
      </label>
      <p>分けた先の明細</p>
      {children.map((c, i) => (
        <div key={i} className="split-row">
          <input aria-label={`品名${i + 1}`} value={c.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="品名" />
          <input aria-label={`数量${i + 1}`} type="number" inputMode="decimal" min={0} step="any" value={c.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
          <input aria-label={`単位${i + 1}`} value={c.unit} onChange={(e) => set(i, { unit: e.target.value })} placeholder="単位" />
          <button type="button" className="btn btn-small" aria-label={`${i + 1}行目を削除`} onClick={() => setChildren((cs) => cs.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-small" onClick={() => setChildren((cs) => [...cs, { name: '', quantity: '1', unit: lot.unit }])}>
        ＋ 行を足す
      </button>
      {confirming ? (
        <div className="notice notice-warn">
          <p>
            「{lot.name}」を {formatQuantity(d, lot.unit)} 減らし、{rows.length} 件の明細を作ります。よろしいですか？
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              戻る
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
              分ける
            </button>
          </div>
        </div>
      ) : (
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => setConfirming(true)}>
            確認へ
          </button>
        </div>
      )}
    </Dialog>
  )
}

function ReviewDialog({ lot, onClose }: { lot: InventoryLot; onClose: () => void }) {
  const [note, setNote] = useState('')
  const { run, busy } = useChange()
  const submit = async () => {
    const ok = await run({ type: 'confirm_review', lot_id: lot.id, expected_updated_at: lot.updated_at, note }, '確認済みにしました')
    if (ok) onClose()
  }
  return (
    <Dialog title="確認済みにする" onClose={onClose}>
      <p>品名・数量などが実物と合っていれば「確認済みにする」を押してください。違う場合は、先に「編集」で直してください。</p>
      <label className="field">
        <span>メモに残すこと（任意）</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：実物で数量を確認" />
      </label>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          やめる
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
          確認済みにする
        </button>
      </div>
    </Dialog>
  )
}
