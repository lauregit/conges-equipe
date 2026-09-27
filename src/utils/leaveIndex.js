import { normName } from './names.js'

// Keep source order: overlapping requests must retain the same precedence as find().
// Build once per leaves update, instead of normalizing the entire history per cell.
export function indexLeavesByEmployee(leaves) {
  const index = new Map()
  for (const leave of leaves) {
    const key = normName(leave.employee)
    if (!index.has(key)) index.set(key, [])
    index.get(key).push(leave)
  }
  return index
}
