import { describe, it, expect } from 'vitest'
import { isDateInRange, leaveOverlapsMonth, doLeavesOverlap } from './dateHelpers'

describe('isDateInRange', () => {
  it('includes the boundaries', () => {
    expect(isDateInRange('2026-02-01', '2026-02-01', '2026-02-28')).toBe(true)
    expect(isDateInRange('2026-02-28', '2026-02-01', '2026-02-28')).toBe(true)
  })
  it('excludes dates just outside', () => {
    expect(isDateInRange('2026-01-31', '2026-02-01', '2026-02-28')).toBe(false)
    expect(isDateInRange('2026-03-01', '2026-02-01', '2026-02-28')).toBe(false)
  })
})

describe('leaveOverlapsMonth', () => {
  const FEB = ['2026-02-01', '2026-02-28'] // [start, end]
  const inFeb = (startDate, endDate) => leaveOverlapsMonth({ startDate, endDate }, ...FEB)

  it('true for a leave fully inside the month', () => {
    expect(inFeb('2026-02-10', '2026-02-12')).toBe(true)
  })
  it('true for a leave that started earlier and ends in the month', () => {
    expect(inFeb('2026-01-25', '2026-02-03')).toBe(true)
  })
  it('true for a leave that starts in the month and spans into the next', () => {
    expect(inFeb('2026-02-25', '2026-03-05')).toBe(true)
  })
  it('REGRESSION: multi-month leave enclosing February counts (old -31 hack failed)', () => {
    // 15 Jan -> 20 Feb: previously endDate > "2026-02-31" was false, dropping it.
    expect(inFeb('2026-01-15', '2026-02-20')).toBe(true)
    // Jan -> Mar fully spanning Feb.
    expect(inFeb('2026-01-10', '2026-03-15')).toBe(true)
  })
  it('true on single-day leaves on the first and last day of the month', () => {
    expect(inFeb('2026-02-01', '2026-02-01')).toBe(true)
    expect(inFeb('2026-02-28', '2026-02-28')).toBe(true)
  })
  it('false for leaves entirely before or after the month', () => {
    expect(inFeb('2026-01-01', '2026-01-31')).toBe(false)
    expect(inFeb('2026-03-01', '2026-03-31')).toBe(false)
  })
})

describe('doLeavesOverlap', () => {
  const leave = { startDate: '2026-05-10', endDate: '2026-05-15' }
  it('true when ranges intersect, are identical, or one contains the other', () => {
    expect(doLeavesOverlap('2026-05-12', '2026-05-13', leave)).toBe(true) // contained
    expect(doLeavesOverlap('2026-05-10', '2026-05-15', leave)).toBe(true) // identical
    expect(doLeavesOverlap('2026-05-14', '2026-05-20', leave)).toBe(true) // partial
    expect(doLeavesOverlap('2026-05-15', '2026-05-15', leave)).toBe(true) // touch on end
    expect(doLeavesOverlap('2026-05-10', '2026-05-10', leave)).toBe(true) // touch on start
  })
  it('false when the ranges are disjoint', () => {
    expect(doLeavesOverlap('2026-05-16', '2026-05-20', leave)).toBe(false)
    expect(doLeavesOverlap('2026-05-01', '2026-05-09', leave)).toBe(false)
  })
})
