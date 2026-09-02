// Data layer : congés + profils + hiérarchie dans Neon (fonctions /api/*),
// personnel depuis RH Compliance. TOUTES les requêtes portent le jeton de
// session maison (voir api/_session.js) — l'identité est vérifiée côté serveur.

import { isApprover, isGlobalAdmin } from './leavePolicy'

const TOKEN_KEY = 'conges_session_token'

export function getSessionToken() {
  return localStorage.getItem(TOKEN_KEY)
}
export function setSessionToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
}
export function clearSessionToken() {
  localStorage.removeItem(TOKEN_KEY)
}

async function authedFetch(url, options = {}) {
  const token = getSessionToken()
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

// SSO Certilogia : valide les identifiants côté serveur et retourne une
// session maison. Ne jette jamais silencieusement — readError() côté appelant.
export async function loginWithCertilogia(email, password) {
  const res = await fetch('/api/certilogia-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw await readError(res, 'Connexion impossible')
  return res.json() // { token, email }
}

async function readError(res, fallback) {
  try {
    const body = await res.json()
    if (body && body.error) return new Error(body.error)
  } catch {
    // pas de corps JSON
  }
  return new Error(fallback)
}

// ── Leaves ──────────────────────────────────────────────────────────────────

export async function fetchLeaves() {
  const res = await authedFetch('/api/leaves')
  if (!res.ok) throw await readError(res, 'Impossible de charger les congés')
  return res.json()
}

export async function addLeave(leave) {
  const res = await authedFetch('/api/leaves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(leave),
  })
  if (!res.ok) throw await readError(res, "Impossible d'enregistrer le congé")
  return res.json()
}

export async function decideLeave(id, _user, action) {
  const res = await authedFetch(`/api/leaves?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  if (!res.ok) throw await readError(res, 'Impossible de traiter la demande')
  return res.json()
}

export async function deleteLeave(id) {
  const res = await authedFetch(`/api/leaves?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw await readError(res, 'Impossible de supprimer le congé')
  return res.json()
}

// ── Personnel + config (RH Compliance + chaîne de commandement) ─────────────

export async function fetchRosterBundle() {
  const res = await authedFetch('/api/roster')
  if (!res.ok) throw await readError(res, 'Impossible de charger le personnel RH')
  const { items, config } = await res.json()
  const employees = items.map(e => ({
    ...e,
    teamKey: e.team,
    active: true,
    role: isGlobalAdmin(e.name, config) ? 'admin'
      : isApprover(e.name, items, config) ? 'manager'
      : 'employee',
  }))
  return { employees, config }
}

// ── Profil (compte connecté -> nom du personnel) ─────────────────────────────

export async function fetchProfile() {
  const res = await authedFetch('/api/profile')
  if (res.status === 404) return null
  if (!res.ok) throw await readError(res, 'Impossible de charger le profil')
  return res.json()
}

export async function saveProfileApi(name) {
  const res = await authedFetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw await readError(res, "Impossible d'enregistrer le profil")
  return res.json()
}

// ── Admin (admins globaux) ───────────────────────────────────────────────────

export async function fetchAdmin() {
  const res = await authedFetch('/api/admin')
  if (!res.ok) throw await readError(res, "Impossible de charger l'administration")
  return res.json()
}

export async function adminAction(payload) {
  const res = await authedFetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw await readError(res, "Échec de l'action admin")
  return res.json()
}

// Export variables de paie (admins globaux) : CSV pour la période donnée.
// Retourne { blob, filename } — à l'appelant de déclencher le téléchargement.
export async function exportPayroll(from, to) {
  const res = await authedFetch(`/api/payroll-export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
  if (!res.ok) throw await readError(res, "Impossible de générer l'export paie")
  const disposition = res.headers.get('Content-Disposition') || ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || `variables-paie_${from}_${to}.csv`
  return { blob: await res.blob(), filename }
}
