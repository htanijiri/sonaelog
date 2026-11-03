// 内部の値の日本語表示名。未知の値は勝手に「その他」にせず、値そのものを出す。

import type { Category, ExpiryCheck, ExpiryKind, LocationKind, Source, UseStatus } from './types'

export const CATEGORY_LABEL: Record<Category, string> = {
  food: '食品',
  water: '水',
  fuel: '燃料',
  power: '電源・電池',
  sanitation: '衛生・トイレ',
  medical: '医療・救急',
  shelter: '寝具・防寒',
  safety: '安全・照明',
  communication: '通信・情報',
  tools: '工具',
  tableware: '食器',
  children: '子ども用品',
  unknown: '分類不明',
}

export const USE_STATUS_LABEL: Record<UseStatus, string> = {
  stored: '通常',
  removed_for_consumption: '優先消費待ち',
  non_drinking_candidate: '生活用水候補',
  replacement_planned: '買い替え予定',
  expired_trial: '試食・買い替え検討',
  near_expiry_keep_pending: '入れ替え判断保留',
}

export const EXPIRY_CHECK_LABEL: Record<ExpiryCheck, string> = {
  exact_or_month_known: '期限を記録済み',
  not_recorded: '期限未確認',
  reported_no_expiry_issue_exact_unknown: '問題なしと確認（日付未記録）',
  reported_within_one_year_exact_unknown: '1年以内と確認（日付未確認）',
}

export const SOURCE_LABEL: Record<Source, string> = {
  user: '本人の報告',
  photo_review: '写真からの仮登録',
  user_confirmed: '確認済み',
}

export const LOCATION_KIND_LABEL: Record<LocationKind, string> = {
  long_term: '長期備蓄',
  go_bag: '非常持ち出し',
  rolling: 'ローリングストック',
  pending_consumption: '期限間近で取り出し済み',
  other: 'その他',
}

export const LOCATION_KIND_ORDER: LocationKind[] = ['long_term', 'go_bag', 'rolling', 'pending_consumption', 'other']

export const EXPIRY_KIND_LABEL: Record<ExpiryKind | 'none', string> = {
  best_before: '賞味期限',
  use_or_inspection: '使用・点検期限',
  none: '期限',
}

export function label<K extends string>(table: Record<K, string>, value: string): string {
  return (table as Record<string, string>)[value] ?? value
}
