import { readFileSync } from 'node:fs'
import { seedToRows, validateSeed } from '../../src/domain/seed'
import type { Snapshot } from '../../src/domain/types'

/** 見本データからスナップショットを作る（id は連番） */
export function sampleSnapshot(): Snapshot {
  const data = validateSeed(JSON.parse(readFileSync('fixtures/sample-data.json', 'utf8'))).data!
  let n = 0
  const { locations, lots } = seedToRows(data, () => `id-${++n}`, '2026-11-03T00:00:00.000Z')
  return { format: 'sonaelog-snapshot', version: 1, household_id: 'h', household_name: '見本', revision: 1, captured_at: '2026-11-03T00:00:00.000Z', locations, lots }
}
export const TODAY = { y: 2026, m: 11, d: 3 }
