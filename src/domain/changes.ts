// 在庫の変更操作。画面はこの形で Backend に渡し、本番は Supabase の apply_change()、
// 開発は疑似クラウドがこのファイルの applyChangeToState() で同じ規則に従って処理する。

import { lotInputSchema, formatIssues } from './schemas'
import type { InventoryLot, LocationKind, LotInput, Snapshot, StorageLocation } from './types'

export type Disposition = 'consumed' | 'discarded'

export type Change =
  | { type: 'create_lot'; lot: LotInput }
  | { type: 'update_lot'; lot_id: string; expected_updated_at: string; patch: Partial<LotInput> }
  | { type: 'set_quantity'; lot_id: string; expected_updated_at: string; quantity: number }
  | {
      type: 'move_lot'
      lot_id: string
      expected_updated_at: string
      to_location_id: string
      /** 省略時は全部。指定すると、その数だけ別の明細として移す */
      quantity?: number
    }
  | {
      type: 'consume'
      lot_id: string
      expected_updated_at: string
      quantity: number
      disposition: Disposition
    }
  | {
      type: 'replace_lot'
      lot_id: string
      expected_updated_at: string
      disposition: Disposition
      new_lot: LotInput
    }
  | {
      type: 'split_lot'
      lot_id: string
      expected_updated_at: string
      /** 元の明細から減らす数 */
      decrease: number
      children: LotInput[]
    }
  | { type: 'confirm_review'; lot_id: string; expected_updated_at: string; note?: string }
  | {
      type: 'upsert_location'
      location_id?: string
      expected_updated_at?: string
      display_name: string
      kind: LocationKind
      physical_note: string | null
    }
  | { type: 'archive_location'; location_id: string; expected_updated_at: string }

export type ChangeErrorCode = 'conflict' | 'validation' | 'not_found'

export class ChangeError extends Error {
  constructor(
    public code: ChangeErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ChangeError'
  }
}

export interface ArchivedFields {
  archived_at: string | null
  archive_reason: string | null
}

export type StoredLot = InventoryLot & ArchivedFields
export type StoredLocation = StorageLocation & { archived_at: string | null }

export interface ChangeEvent {
  id: string
  lot_id: string | null
  location_id: string | null
  actor_user_id: string
  event_type: string
  previous_value: unknown
  new_value: unknown
  occurred_at: string
}

export interface HouseholdState {
  household_id: string
  household_name: string
  revision: number
  locations: StoredLocation[]
  lots: StoredLot[]
  events: ChangeEvent[]
}

export interface ChangeContext {
  actor: string
  now: string
  newId: () => string
}

export function validateLotInput(input: LotInput): void {
  const result = lotInputSchema.safeParse(input)
  if (!result.success) throw new ChangeError('validation', formatIssues(result.error).join('\n'))
}

function activeLot(state: HouseholdState, id: string, expected: string): StoredLot {
  const lot = state.lots.find((l) => l.id === id && l.archived_at === null)
  if (!lot) throw new ChangeError('not_found', '明細が見つかりません（ほかの家族が削除した可能性があります）')
  if (lot.updated_at !== expected) {
    throw new ChangeError('conflict', 'ほかの家族が先に変更しました。最新を読み込んでからやり直してください')
  }
  return lot
}

function activeLocation(state: HouseholdState, id: string): StoredLocation {
  const loc = state.locations.find((l) => l.id === id && l.archived_at === null)
  if (!loc) throw new ChangeError('validation', '保管場所が見つかりません')
  return loc
}

function positive(n: number, label: string) {
  if (!(Number.isFinite(n) && n > 0)) throw new ChangeError('validation', `${label}は 0 より大きくしてください`)
}

/**
 * 変更を1つ適用する。すべて検証してから状態を書き換えるので、途中で失敗しても何も変わらない
 * （SQL 側は1トランザクションで同じことを保証する）。
 */
export function applyChangeToState(state: HouseholdState, change: Change, ctx: ChangeContext): void {
  const events: ChangeEvent[] = []
  const record = (
    event_type: string,
    ids: { lot_id?: string; location_id?: string },
    previous_value: unknown,
    new_value: unknown,
  ) =>
    events.push({
      id: ctx.newId(),
      lot_id: ids.lot_id ?? null,
      location_id: ids.location_id ?? null,
      actor_user_id: ctx.actor,
      event_type,
      previous_value,
      new_value,
      occurred_at: ctx.now,
    })
  // 書き換えは最後にまとめて行う
  const mutations: (() => void)[] = []

  const newLot = (input: LotInput): StoredLot => {
    validateLotInput(input)
    activeLocation(state, input.location_id)
    return {
      ...input,
      id: ctx.newId(),
      seed_code: null,
      created_at: ctx.now,
      updated_at: ctx.now,
      archived_at: null,
      archive_reason: null,
    }
  }
  const reduce = (lot: StoredLot, amount: number, reason: string) => {
    if (amount > lot.quantity) throw new ChangeError('validation', `残りの数量（${lot.quantity}）より多くは減らせません`)
    const quantity = lot.quantity - amount
    mutations.push(() => {
      lot.quantity = quantity
      lot.updated_at = ctx.now
      if (quantity === 0) {
        lot.archived_at = ctx.now
        lot.archive_reason = reason
      }
    })
  }

  switch (change.type) {
    case 'create_lot': {
      const lot = newLot(change.lot)
      mutations.push(() => state.lots.push(lot))
      record('create', { lot_id: lot.id }, null, change.lot)
      break
    }
    case 'update_lot': {
      const lot = activeLot(state, change.lot_id, change.expected_updated_at)
      const { id: _id, seed_code: _s, created_at: _c, updated_at: _u, archived_at: _a, archive_reason: _r, ...current } = lot
      const next: LotInput = { ...current, ...change.patch }
      validateLotInput(next)
      if (next.location_id !== lot.location_id) activeLocation(state, next.location_id)
      if (next.quantity === 0) throw new ChangeError('validation', '数量を 0 にするときは「消費・廃棄」を使ってください')
      mutations.push(() => Object.assign(lot, next, { updated_at: ctx.now }))
      record('update', { lot_id: lot.id }, current, next)
      break
    }
    case 'set_quantity': {
      const lot = activeLot(state, change.lot_id, change.expected_updated_at)
      if (!(Number.isFinite(change.quantity) && change.quantity >= 0)) {
        throw new ChangeError('validation', '数量は 0 以上にしてください')
      }
      const quantity = change.quantity
      mutations.push(() => {
        lot.quantity = quantity
        lot.updated_at = ctx.now
        if (quantity === 0) {
          lot.archived_at = ctx.now
          lot.archive_reason = 'quantity_zero'
        }
      })
      record('set_quantity', { lot_id: lot.id }, { quantity: lot.quantity }, { quantity })
      break
    }
    case 'move_lot': {
      const lot = activeLot(state, change.lot_id, change.expected_updated_at)
      activeLocation(state, change.to_location_id)
      if (change.to_location_id === lot.location_id) throw new ChangeError('validation', '同じ保管場所には移せません')
      const amount = change.quantity ?? lot.quantity
      positive(amount, '移す数')
      if (amount > lot.quantity) throw new ChangeError('validation', `残りの数量（${lot.quantity}）より多くは移せません`)
      if (amount === lot.quantity) {
        mutations.push(() => {
          lot.location_id = change.to_location_id
          lot.updated_at = ctx.now
        })
        record('move', { lot_id: lot.id }, { location_id: lot.location_id }, { location_id: change.to_location_id })
      } else {
        const { id: _id, seed_code: _s, created_at: _c, updated_at: _u, archived_at: _a, archive_reason: _r, ...rest } = lot
        const moved = newLot({ ...rest, location_id: change.to_location_id, quantity: amount })
        mutations.push(() => {
          lot.quantity -= amount
          lot.updated_at = ctx.now
          state.lots.push(moved)
        })
        record('move_partial', { lot_id: lot.id }, { quantity: lot.quantity }, { new_lot_id: moved.id, quantity: amount, location_id: change.to_location_id })
      }
      break
    }
    case 'consume': {
      const lot = activeLot(state, change.lot_id, change.expected_updated_at)
      positive(change.quantity, change.disposition === 'consumed' ? '使った数' : '捨てた数')
      reduce(lot, change.quantity, change.disposition)
      record(change.disposition, { lot_id: lot.id }, { quantity: lot.quantity }, { quantity: lot.quantity - change.quantity })
      break
    }
    case 'replace_lot': {
      const lot = activeLot(state, change.lot_id, change.expected_updated_at)
      const created = newLot(change.new_lot)
      mutations.push(() => {
        lot.archived_at = ctx.now
        lot.archive_reason = change.disposition
        lot.updated_at = ctx.now
        state.lots.push(created)
      })
      record('replace', { lot_id: lot.id }, { quantity: lot.quantity, disposition: change.disposition }, { new_lot_id: created.id })
      break
    }
    case 'split_lot': {
      const lot = activeLot(state, change.lot_id, change.expected_updated_at)
      positive(change.decrease, '減らす数')
      if (change.children.length === 0) throw new ChangeError('validation', '分けた先の明細を1つ以上入れてください')
      const children = change.children.map(newLot)
      reduce(lot, change.decrease, 'split')
      mutations.push(() => state.lots.push(...children))
      record('split', { lot_id: lot.id }, { quantity: lot.quantity }, { decrease: change.decrease, children: children.map((c) => c.id) })
      break
    }
    case 'confirm_review': {
      const lot = activeLot(state, change.lot_id, change.expected_updated_at)
      const note = change.note?.trim()
      const notes = note ? (lot.notes ? `${lot.notes}\n${note}` : note) : lot.notes
      const source = lot.source === 'photo_review' ? 'user_confirmed' : lot.source
      mutations.push(() => Object.assign(lot, { needs_review: false, source, notes, updated_at: ctx.now }))
      record('confirm_review', { lot_id: lot.id }, { needs_review: lot.needs_review, source: lot.source }, { needs_review: false, source })
      break
    }
    case 'upsert_location': {
      const name = change.display_name.trim()
      if (!name) throw new ChangeError('validation', '保管場所の名前を入れてください')
      const note = change.physical_note?.trim() || null
      if (change.location_id) {
        const loc = activeLocation(state, change.location_id)
        if (loc.updated_at !== change.expected_updated_at) {
          throw new ChangeError('conflict', 'ほかの家族が先に変更しました。最新を読み込んでからやり直してください')
        }
        const prev = { display_name: loc.display_name, kind: loc.kind, physical_note: loc.physical_note }
        mutations.push(() => Object.assign(loc, { display_name: name, kind: change.kind, physical_note: note, updated_at: ctx.now }))
        record('location_update', { location_id: loc.id }, prev, { display_name: name, kind: change.kind, physical_note: note })
      } else {
        const loc: StoredLocation = {
          id: ctx.newId(),
          seed_code: null,
          display_name: name,
          kind: change.kind,
          physical_note: note,
          parent_id: null,
          sort_order: Math.max(0, ...state.locations.map((l) => l.sort_order)) + 1,
          updated_at: ctx.now,
          archived_at: null,
        }
        mutations.push(() => state.locations.push(loc))
        record('location_create', { location_id: loc.id }, null, { display_name: name, kind: change.kind, physical_note: note })
      }
      break
    }
    case 'archive_location': {
      const loc = activeLocation(state, change.location_id)
      if (loc.updated_at !== change.expected_updated_at) {
        throw new ChangeError('conflict', 'ほかの家族が先に変更しました。最新を読み込んでからやり直してください')
      }
      if (state.lots.some((l) => l.location_id === loc.id && l.archived_at === null)) {
        throw new ChangeError('validation', '中身がある保管場所は削除できません。先に中身を移してください')
      }
      mutations.push(() => {
        loc.archived_at = ctx.now
        loc.updated_at = ctx.now
      })
      record('location_archive', { location_id: loc.id }, null, null)
      break
    }
  }

  for (const m of mutations) m()
  state.events.push(...events)
  state.revision += 1
}

/** アーカイブ済みを除いた、家庭のスナップショットを作る（SQL の get_household_snapshot と同じ形） */
export function stateToSnapshot(state: HouseholdState, now: string): Snapshot {
  return {
    format: 'sonaelog-snapshot',
    version: 1,
    household_id: state.household_id,
    household_name: state.household_name,
    revision: state.revision,
    captured_at: now,
    locations: state.locations
      .filter((l) => l.archived_at === null)
      .map(({ archived_at: _a, ...l }) => ({ ...l })),
    lots: state.lots
      .filter((l) => l.archived_at === null)
      .map(({ archived_at: _a, archive_reason: _r, ...l }) => ({ ...l })),
  }
}
