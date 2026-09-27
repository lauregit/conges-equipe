import { describe, it, expect } from 'vitest'
import { indexLeavesByEmployee } from './leaveIndex.js'
import { normName, sameName } from './names.js'
import { isDateInRange } from './dateHelpers.js'

describe('indexed calendar and presence lookup', () => {
  it('preserves ordering, accents, overlapping requests, silhouettes and inclusive dates', () => {
    const leaves = [
      { employee: 'Éden Test', startDate: '2026-08-30', endDate: '2026-09-02', status: 'rejected' },
      { employee: ' eden  TEST ', startDate: '2026-08-30', endDate: '2026-09-02', status: 'pending' },
      { employee: 'EDEN TEST', startDate: '2026-09-01', endDate: '2026-09-03', status: 'approved' },
      { employee: 'Autre', startDate: '2026-09-01', endDate: '2026-09-03', status: 'approved', restricted: true, type: null },
    ]
    const index = indexLeavesByEmployee(leaves)
    for (const name of ['Eden Test', 'Autre', 'Inconnu']) {
      for (const date of ['2026-08-29', '2026-08-30', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']) {
        for (const status of [s => s !== 'rejected', s => s === 'approved', s => s === 'pending']) {
          const matches = l => status(l.status) && isDateInRange(date, l.startDate, l.endDate)
          const original = leaves.find(l => sameName(l.employee, name) && matches(l))
          expect((index.get(normName(name)) || []).find(matches)).toBe(original)
        }
      }
    }
    expect(index.get('EDEN TEST')).toEqual(leaves.slice(0, 3))
  })
  it('rebuilds from changed data without retaining deleted leaves', () => {
    const original = [{ employee: 'A' }]
    expect(indexLeavesByEmployee(original).get('A')).toEqual(original)
    expect(indexLeavesByEmployee([]).has('A')).toBe(false)
  })
})
