// Data layer : congés dans Firestore, personnel depuis RH Compliance
// (via la fonction serverless /api/roster — voir api/roster.js).
import {
  collection, getDocs, addDoc, deleteDoc,
  doc, query, orderBy, serverTimestamp, runTransaction
} from 'firebase/firestore'
import { db } from './firebase'
import { GLOBAL_SUPER_ADMINS } from './employees'
import { initialStatus, canDecide, isApprover } from './leavePolicy'
import { normName } from './utils/names'

const LEAVES_COL = 'leaves'

// ── Leaves ──────────────────────────────────────────────────────────────────

export async function fetchLeaves() {
  const q = query(collection(db, LEAVES_COL), orderBy('startDate'))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// `roster` = lignes RH (fetchEmployees) — sert à déterminer le statut initial.
export async function addLeave(leave, roster = []) {
  const employee = leave.employee
  const submittedBy = leave.submittedBy || employee
  const data = {
    employee,
    startDate: leave.startDate,
    endDate: leave.endDate,
    type: leave.type,
    note: leave.note || '',
    // Workflow manager : pending sauf déclaration (arrêt maladie), saisie
    // par un approbateur, admin global, ou équipe sans approbateur configuré.
    status: initialStatus({ type: leave.type, employee, submittedBy }, roster),
    submittedBy,
    decidedBy: null,
    decidedAt: null,
    createdAt: serverTimestamp(),
  }
  // Une saisie par un approbateur pour quelqu'un d'autre vaut validation.
  if (data.status === 'approved' && normName(submittedBy) !== normName(employee)) {
    data.decidedBy = submittedBy
    data.decidedAt = serverTimestamp()
  }
  const ref = await addDoc(collection(db, LEAVES_COL), data)
  return { id: ref.id, ...data }
}

// Décision manager : transactionnelle pour éviter qu'une demande soit
// décidée deux fois (deux managers cliquant en même temps).
export async function decideLeave(id, user, action, roster = []) {
  const status = action === 'approve' ? 'approved' : 'rejected'
  const ref = doc(db, LEAVES_COL, id)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Demande introuvable')
    const leave = snap.data()
    if (leave.status !== 'pending') throw new Error('Cette demande a déjà été traitée')
    if (!canDecide(user, leave.employee, roster)) {
      throw new Error("Seul un manager de l'équipe peut décider cette demande")
    }
    tx.update(ref, { status, decidedBy: user, decidedAt: serverTimestamp() })
  })
  return { id, status }
}

export async function deleteLeave(id) {
  await deleteDoc(doc(db, LEAVES_COL, id))
  return { id }
}

// ── Employees ────────────────────────────────────────────────────────────────
// Personnel + organigramme depuis RH Compliance. role :
//   'admin'    = admin global (voit tout, approuve tout)
//   'manager'  = manage au moins un pôle (organigramme ou EXTRA_APPROVERS)
//   'employee' = membre

export async function fetchEmployees() {
  const res = await fetch('/api/roster')
  if (!res.ok) throw new Error('Impossible de charger le personnel RH')
  const { items } = await res.json()
  return items.map(e => ({
    name: e.name,
    email: e.email,
    team: e.team,          // pôle de l'organigramme
    teamKey: e.team,
    position: e.position,
    manager: !!e.manager,  // manager de son pôle (organigramme)
    type: e.type,
    active: true,
    role: GLOBAL_SUPER_ADMINS.some(a => normName(a) === normName(e.name)) ? 'admin'
      : isApprover(e.name, items) ? 'manager'
      : 'employee',
  }))
}

export async function saveEmployee() {
  // No-op — le personnel se gère dans RH Compliance
  // (https://rh-compliance.vercel.app), les approbateurs dans src/employees.js.
}
