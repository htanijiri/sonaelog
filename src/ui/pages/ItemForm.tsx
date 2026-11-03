import { useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import type { Disposition } from '../../domain/changes'
import { effectiveExpiry, formatExpiry } from '../../domain/expiry'
import { CATEGORY_LABEL, EXPIRY_CHECK_LABEL, EXPIRY_KIND_LABEL, USE_STATUS_LABEL } from '../../domain/labels'
import { formatIssues, lotInputSchema } from '../../domain/schemas'
import { monthsLabel, shelfLifeSuggestions } from '../../domain/shelfLifePresets'
import {
  CATEGORIES,
  USE_STATUSES,
  type Category,
  type ExpiryCheck,
  type ExpiryKind,
  type InventoryLot,
  type LotInput,
  type Precision,
  type UseStatus,
} from '../../domain/types'
import { useApp } from '../../state/AppContext'
import { BackButton } from '../components/BackButton'
import { useChange } from '../useChange'

type DateMode = 'none' | Precision

interface FormState {
  name: string
  quantity: string
  unit: string
  category: Category
  location_id: string
  expiryMode: DateMode
  expiry: string
  expiry_kind: ExpiryKind | ''
  expiry_check: ExpiryCheck
  mfgMode: DateMode
  mfg: string
  shelfYears: string
  use_status: UseStatus
  notes: string
  liters: string
  uses: string
  needs_review: boolean
}

function fromLot(lot: InventoryLot, keepExpiry: boolean): FormState {
  return {
    name: lot.name,
    quantity: String(lot.quantity),
    unit: lot.unit,
    category: lot.category,
    location_id: lot.location_id,
    expiryMode: keepExpiry ? (lot.expiry_precision ?? 'none') : 'month',
    expiry: keepExpiry ? (lot.expiry_value ?? '') : '',
    expiry_kind: lot.expiry_kind ?? '',
    expiry_check: keepExpiry && lot.expiry_check !== 'exact_or_month_known' ? lot.expiry_check : 'not_recorded',
    mfgMode: keepExpiry ? (lot.manufactured_precision ?? 'none') : 'none',
    mfg: keepExpiry ? (lot.manufactured_value ?? '') : '',
    shelfYears: lot.shelf_life_months ? String(lot.shelf_life_months / 12) : '',
    use_status: keepExpiry ? lot.use_status : 'stored',
    notes: keepExpiry ? lot.notes : '',
    liters: lot.liters_per_unit === null ? '' : String(lot.liters_per_unit),
    uses: lot.uses_per_unit === null ? '' : String(lot.uses_per_unit),
    needs_review: keepExpiry ? lot.needs_review : false,
  }
}

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s))

function toInput(f: FormState, source: InventoryLot['source'], components: InventoryLot['components']): LotInput {
  const hasExpiry = f.expiryMode !== 'none' && f.expiry !== ''
  const hasMfg = f.mfgMode !== 'none' && f.mfg !== ''
  const years = numOrNull(f.shelfYears)
  return {
    name: f.name.trim(),
    quantity: Number(f.quantity),
    unit: f.unit.trim(),
    category: f.category,
    location_id: f.location_id,
    expiry_value: hasExpiry ? f.expiry : null,
    expiry_precision: hasExpiry ? (f.expiryMode as Precision) : null,
    expiry_kind: f.expiry_kind || null,
    expiry_check: hasExpiry ? 'exact_or_month_known' : f.expiry_check,
    manufactured_value: hasMfg ? f.mfg : null,
    manufactured_precision: hasMfg ? (f.mfgMode as Precision) : null,
    shelf_life_months: years === null ? null : Math.round(years * 12),
    use_status: f.use_status,
    source,
    needs_review: f.needs_review,
    notes: f.notes,
    liters_per_unit: numOrNull(f.liters),
    kcal_per_unit: null,
    uses_per_unit: numOrNull(f.uses),
    components,
  }
}

export function ItemForm() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { snapshot, editable } = useApp()
  const navigate = useNavigate()
  const { run, busy } = useChange()

  const editing = id ? snapshot!.lots.find((l) => l.id === id) : undefined
  const replacing = params.get('replace') ? snapshot!.lots.find((l) => l.id === params.get('replace')) : undefined
  const locations = [...snapshot!.locations].sort((a, b) => a.sort_order - b.sort_order)
  const defaultLocation = params.get('location') ?? locations[0]?.id ?? ''

  const [f, setF] = useState<FormState>(() =>
    editing
      ? fromLot(editing, true)
      : replacing
        ? fromLot(replacing, false)
        : {
            name: '',
            quantity: '1',
            unit: '個',
            category: 'food',
            location_id: defaultLocation,
            expiryMode: 'month',
            expiry: '',
            expiry_kind: '',
            expiry_check: 'not_recorded',
            mfgMode: 'none',
            mfg: '',
            shelfYears: '',
            use_status: 'stored',
            notes: '',
            liters: '',
            uses: '',
            needs_review: false,
          },
  )
  const [disposition, setDisposition] = useState<Disposition>('consumed')
  const [errors, setErrors] = useState<string[]>([])
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }))

  if ((id && !editing) || (params.get('replace') && !replacing)) {
    return <p>明細が見つかりません。</p>
  }
  const title = editing ? '明細を編集' : replacing ? `買い替え：${replacing.name}` : '明細を追加'
  const base = editing ?? replacing
  const input = toInput(f, editing ? editing.source : 'user', base?.components ?? null)
  const preview = effectiveExpiry(input)
  const suggestions = shelfLifeSuggestions(f.name, snapshot!.lots, editing?.id)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const extra: string[] = []
    if (f.expiryMode !== 'none' && f.expiry === '') extra.push('期限の日付を入れるか、「なし」を選んでください')
    if (f.mfgMode !== 'none' && f.mfg === '') extra.push('製造年月を入れるか、「なし」を選んでください')
    if (!(input.quantity > 0)) extra.push('数量は 0 より大きくしてください（0 にするときは「消費・廃棄」）')
    const parsed = lotInputSchema.safeParse(input)
    const all = [...extra, ...(parsed.success ? [] : formatIssues(parsed.error, (p) => FIELD_NAME[String(p[0])] ?? String(p[0])))]
    setErrors(all)
    if (all.length) return

    let ok: boolean
    if (editing) {
      ok = await run({ type: 'update_lot', lot_id: editing.id, expected_updated_at: editing.updated_at, patch: input })
    } else if (replacing) {
      ok = await run(
        { type: 'replace_lot', lot_id: replacing.id, expected_updated_at: replacing.updated_at, disposition, new_lot: input },
        '買い替えを保存しました',
      )
    } else {
      ok = await run({ type: 'create_lot', lot: input }, '追加しました')
    }
    if (ok) navigate(editing ? `/items/${editing.id}` : '/items', { replace: true })
  }

  return (
    <form className="stack form" onSubmit={(e) => void submit(e)} noValidate>
      <BackButton />
      <h1 className="page-title">{title}</h1>
      {!editable && <p className="notice notice-warn">オフライン、またはログインしていないため保存できません。</p>}
      {replacing && (
        <fieldset className="radios">
          <legend>古い明細（{replacing.name}）の扱い</legend>
          <label className="check">
            <input type="radio" name="disp" checked={disposition === 'consumed'} onChange={() => setDisposition('consumed')} />
            使った（消費）として外す
          </label>
          <label className="check">
            <input type="radio" name="disp" checked={disposition === 'discarded'} onChange={() => setDisposition('discarded')} />
            捨てた（廃棄）として外す
          </label>
          <p className="muted small">新しい明細は、元の明細に足さず別の明細として追加します。</p>
        </fieldset>
      )}

      <label className="field">
        <span>品名</span>
        <input value={f.name} onChange={(e) => set('name', e.target.value)} required />
      </label>
      <div className="row">
        <label className="field">
          <span>数量</span>
          <input type="number" inputMode="decimal" min={0} step="any" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </label>
        <label className="field">
          <span>単位</span>
          <input value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder="本・缶・袋・食など" />
        </label>
      </div>
      <label className="field">
        <span>カテゴリ</span>
        <select value={f.category} onChange={(e) => set('category', e.target.value as Category)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>保管場所</span>
        <select value={f.location_id} onChange={(e) => set('location_id', e.target.value)}>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.display_name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="group">
        <legend>期限（印字されているもの）</legend>
        <DateModeRadios name="expiryMode" value={f.expiryMode} onChange={(m) => setF((p) => ({ ...p, expiryMode: m, expiry: '' }))} />
        {f.expiryMode !== 'none' && (
          <input
            type={f.expiryMode === 'day' ? 'date' : 'month'}
            aria-label="期限"
            value={f.expiry}
            onChange={(e) => set('expiry', e.target.value)}
            placeholder={f.expiryMode === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM'}
          />
        )}
        <label className="field">
          <span>期限の種類</span>
          <select value={f.expiry_kind} onChange={(e) => set('expiry_kind', e.target.value as ExpiryKind | '')}>
            <option value="">{EXPIRY_KIND_LABEL.none}（種類不明）</option>
            <option value="best_before">{EXPIRY_KIND_LABEL.best_before}</option>
            <option value="use_or_inspection">{EXPIRY_KIND_LABEL.use_or_inspection}</option>
          </select>
        </label>
        {f.expiryMode === 'none' && (
          <label className="field">
            <span>期限の確認状況</span>
            <select value={f.expiry_check} onChange={(e) => set('expiry_check', e.target.value as ExpiryCheck)}>
              {(['not_recorded', 'reported_no_expiry_issue_exact_unknown', 'reported_within_one_year_exact_unknown'] as const).map((c) => (
                <option key={c} value={c}>
                  {EXPIRY_CHECK_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>

      <fieldset className="group">
        <legend>製造年月（期限が印字されていない品）</legend>
        <DateModeRadios name="mfgMode" value={f.mfgMode} onChange={(m) => setF((p) => ({ ...p, mfgMode: m, mfg: '' }))} />
        {f.mfgMode !== 'none' && (
          <input type={f.mfgMode === 'day' ? 'date' : 'month'} aria-label="製造年月" value={f.mfg} onChange={(e) => set('mfg', e.target.value)} />
        )}
        <label className="field">
          <span>製造から何年が期限か</span>
          <span className="inline">
            <input type="number" inputMode="numeric" min={0} step="1" value={f.shelfYears} onChange={(e) => set('shelfYears', e.target.value)} aria-label="製造から何年" />
            年
          </span>
        </label>
        <div className="chips" aria-label="よく使う年数">
          {suggestions.map((s) => (
            <button key={`${s.label}-${s.months}`} type="button" className="chip" onClick={() => set('shelfYears', String(s.months / 12))}>
              {s.label}：製造から{monthsLabel(s.months)}
            </button>
          ))}
        </div>
        <p className="muted small">候補は目安です。品のラベルや説明書と違うときは数字を直接入れてください。</p>
        <p data-testid="expiry-preview">
          {preview
            ? preview.source === 'printed'
              ? `判定に使う期限：${formatExpiry(input).text}（印字の期限を優先）`
              : `計算した期限：${formatExpiry(input).text}（${formatExpiry(input).note}）`
            : '判定に使う期限：なし（期限未確認として扱います）'}
        </p>
      </fieldset>

      <label className="field">
        <span>管理の状態</span>
        <select value={f.use_status} onChange={(e) => set('use_status', e.target.value as UseStatus)}>
          {USE_STATUSES.map((u) => (
            <option key={u} value={u}>
              {USE_STATUS_LABEL[u]}
            </option>
          ))}
        </select>
      </label>
      {f.category === 'water' && (
        <label className="field">
          <span>1{f.unit || '本'}あたりのリットル</span>
          <input type="number" inputMode="decimal" min={0} step="any" value={f.liters} onChange={(e) => set('liters', e.target.value)} />
        </label>
      )}
      {f.category === 'sanitation' && (
        <label className="field">
          <span>公称の使用回数（1{f.unit || 'セット'}あたり。トイレ用品で、パッケージで確認できたときだけ）</span>
          <input type="number" inputMode="numeric" min={0} step="any" value={f.uses} onChange={(e) => set('uses', e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>メモ（購入予定の品はここに書き、在庫には足さない）</span>
        <textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={f.needs_review} onChange={(e) => set('needs_review', e.target.checked)} />
        要確認の印を付ける
      </label>

      {errors.length > 0 && (
        <ul className="field-errors" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <button type="submit" className="btn btn-primary" disabled={!editable || busy}>
        保存する
      </button>
    </form>
  )
}

const FIELD_NAME: Record<string, string> = {
  name: '品名',
  quantity: '数量',
  unit: '単位',
  location_id: '保管場所',
  expiry_value: '期限',
  expiry_check: '期限の確認状況',
  manufactured_value: '製造年月',
  shelf_life_months: '製造から何年',
  liters_per_unit: 'リットル',
  uses_per_unit: '使用回数',
}

function DateModeRadios({ name, value, onChange }: { name: string; value: DateMode; onChange: (m: DateMode) => void }) {
  const options: { v: DateMode; label: string }[] = [
    { v: 'day', label: '年月日' },
    { v: 'month', label: '年月' },
    { v: 'none', label: 'なし' },
  ]
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <label key={o.v} className={`seg-item ${value === o.v ? 'is-on' : ''}`}>
          <input type="radio" name={name} checked={value === o.v} onChange={() => onChange(o.v)} />
          {o.label}
        </label>
      ))}
    </div>
  )
}
