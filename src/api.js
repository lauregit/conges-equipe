// Firestore-backed data layer — no server needed.
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, query, orderBy, serverTimestamp
} from 'firebase/firestore'
import { db } from './firebase'
import { ALL_EMPLOYEES, SUPER_ADMIN_NAMES, TEAMS, getTeamOf } from './employees'

const LEAVES_COL = 'leaves'

// ── Leaves ──────────────────────────────────────────────────────────────────

export async function fetchLeaves() {
  const q = query(collection(db, LEAVES_COL), orderBy('startDate'))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function addLeave(leave) {
  const data = {
    employee: leave.employee,
    startDate: leave.startDate,
    endDate: leave.endDate,
    type: leave.type,
    note: leave.note || '',
    status: 'approved', // direct approval, no manager flow for now
    createdAt: serverTimestamp(),
  }
  const ref = await addDoc(collection(db, LEAVES_COL), data)
  return { id: ref.id, ...data }
}

export async function decideLeave(id, user, action) {
  const ref = doc(db, LEAVES_COL, id)
  await updateDoc(ref, { status: action === 'approve' ? 'approved' : 'rejected' })
  return { id, status: action === 'approve' ? 'approved' : 'rejected' }
}

export async function deleteLeave(id) {
  await deleteDoc(doc(db, LEAVES_COL, id))
  return { id }
}

// ── Employees ────────────────────────────────────────────────────────────────
// Built from the static list — no DB needed for the roster.

export async function fetchEmployees() {
  return ALL_EMPLOYEES.map(name => {
    const team = getTeamOf(name)
    return {
      name,
      active: true,
      team: team?.name || '',
      teamKey: team?.key || '',
      role: SUPER_ADMIN_NAMES.includes(name) ? 'admin' : 'employee',
    }
  })
}

export async function saveEmployee() {
  // No-op for now — roster is managed in src/employees.js
}
