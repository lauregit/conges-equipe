// Pure date helpers working on canonical 'yyyy-MM-dd' strings.
// Because that format sorts lexicographically the same as chronologically,
// plain string comparison is correct and avoids Date/timezone pitfalls.

/** True if `date` falls within [start, end] inclusive. All 'yyyy-MM-dd'. */
export function isDateInRange(date, start, end) {
  return date >= start && date <= end
}

/**
 * True if a leave (with startDate/endDate) intersects the month whose bounds
 * are [monthStart, monthEnd] inclusive. Replaces the old buggy filter that
 * used `endDate > 'yyyy-MM-31'` and silently dropped multi-month leaves.
 */
export function leaveOverlapsMonth(leave, monthStart, monthEnd) {
  return leave.startDate <= monthEnd && leave.endDate >= monthStart
}

/** True if the range [startA, endA] overlaps the given leave's range. */
export function doLeavesOverlap(startA, endA, leave) {
  return startA <= leave.endDate && endA >= leave.startDate
}
