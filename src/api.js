// Data layer : congés + profils dans Neon Postgres (fonctions /api/*),
// personnel & organigramme depuis RH Compliance (/api/roster).
// Firebase ne sert plus qu'à l'authentification (identité).

import { GLOBAL_SUPER_ADMINS } from './employees'
import { isApprover } from './leavePolicy'
import { normName } from './utils/names'

const LEAVES = '/api/leaves';

// Remonte le message d'erreur français du serveur, sinon un générique.
async function readError(res, fallback) {
  try {
    const body = await res.json();
    if (body && body.error) return new Error(body.error);
  } catch {
    // pas de corps JSON
  }
  return new Error(fallback)
}

// ── Leaves ──────────────────────────────────────────────────────────────────

export async function fetchLeaves() {
  const res = await fetch(LEAVES)
  if (!res.ok) throw await readError(res, 'Impossible de charger les congés')
  return res.json()
}

// Le serveur applique la policy (statut initial, droits de saisie) — le
// paramètre roster n'est plus nécessaire, conservé pour compatibilité d'appel.
export async function addLeave(leave) {
  const res = await fetch(LEAVES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(leave),
  })
  if (!res.ok) throw await readError(res, "Impossible d'enregistrer le congé")
  return res.json()
}

export async function decideLeave(id, user, action) {
  const res = await fetch(`${LEAVES}?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, action }),
  })
  if (!res.ok) throw await readError(res, 'Impossible de traiter la demande')
  return res.json()
}

export async function deleteLeave(id, user) {
  const res = await fetch(
    `${LEAVES}?id=${encodeURIComponent(id)}&user=${encodeURIComponent(user || '')}`,
    { method: 'DELETE' }
  )
  if (!res.ok) throw await readError(res, 'Impossible de supprimer le congé')
  return res.json()
}

// ── Employees (RH Compliance) ────────────────────────────────────────────────

export async function fetchEmployees() {
  const res = await fetch('/api/roster')
  if (!res.ok) throw await readError(res, 'Impossible de charger le personnel RH')
  const { items } = await res.json()
  return items.map(e => ({
    name: e.name,
    email: e.email,
    team: e.team,
    teamKey: e.team,
    position: e.position,
    manager: !!e.manager,
    type: e.type,
    active: true,
    role: GLOBAL_SUPER_ADMINS.some(a => normName(a) === normName(e.name)) ? 'admin'
      : isApprover(e.name, items) ? 'manager'
      : 'employee',
  }))
}

// ── Profils (uid Firebase -> nom) ────────────────────────────────────────────

export async function fetchProfile(uid) {
  const res = await fetch(`/api/profile?uid=${encodeURIComponent(uid)}`)
  if (res.status === 404) return null
  if (!res.ok) throw await readError(res, 'Impossible de charger le profil')
  return res.json()
}

export async function saveProfileApi(uid, name, email) {
  const res = await fetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, name, email }),
  })
  if (!res.ok) throw await readError(res, "Impossible d'enregistrer le profil")
  return res.json()
}

// ── Import one-shot Firestore -> Neon (admin global) ─────────────────────────

export async function importFirestoreLeaves(actor, leaves) {
  const res = await fetch('/api/import-firestore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor, leaves }),
  })
  if (!res.ok) throw await readError(res, "Échec de l'import")
  return res.json()
}
