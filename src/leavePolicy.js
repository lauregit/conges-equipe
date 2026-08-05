// Règles du workflow — fonctions pures, testables.
//
// Le roster (via /api/roster) vient de la base RH Compliance PARTAGÉE
// (rh_entities + rh_org — éditable ici en Admin ET dans RH Compliance) :
//   - personnel : { name, team, manager, email, ... }
//   - organigramme (table rh_org) :
//       supervisor    = N+1 (remonte jusqu'à 5 niveaux)
//       rhSupervisor  = superviseur RH désigné — SEUL destinataire des
//                       demandes de congé de la personne
//       replacements  = remplaçants (binômes anti-chevauchement d'absences)
//   - la config (DB, éditable en Admin) : { globalAdmins, extraApprovers }
//
// Visibilité : chacun voit les personnes EN DESSOUS de lui dans la chaîne
// (son sous-arbre) ; les admins globaux voient tout.
// Approbation : superviseur RH désigné → sinon (transition) les managers du
// pôle (organigramme) et approbateurs délégués → plus les admins globaux.

import { EXTRA_APPROVERS, GLOBAL_SUPER_ADMINS } from './employees.js'
import { DECLARED_TYPES, MAX_STANDARD_LEAVE_DAYS } from './constants.js'
import { normName, findByName } from './utils/names.js'

export const MAX_CHAIN = 5

const DEFAULT_CONFIG = { extraApprovers: EXTRA_APPROVERS, globalAdmins: GLOBAL_SUPER_ADMINS }

export function teamOf(name, roster) {
  return findByName(roster, name)?.team || null
}

export function isGlobalAdmin(name, config = DEFAULT_CONFIG) {
  const n = normName(name)
  return (config.globalAdmins || []).some(a => normName(a) === n)
}

// Chaîne de commandement ASCENDANTE de `name` : [N+1, N+2, ...] (max 5,
// protégée contre les cycles).
export function chainOf(name, roster) {
  const chain = []
  const seen = new Set([normName(name)])
  let current = findByName(roster, name)
  for (let i = 0; i < MAX_CHAIN; i++) {
    const supName = current?.supervisor
    if (!supName) break
    const sup = findByName(roster, supName)
    const key = normName(supName)
    if (seen.has(key)) break // cycle
    seen.add(key)
    chain.push(sup?.name || supName)
    current = sup
    if (!sup) break
  }
  return chain
}

// `viewer` voit-il les données de `employee` ? (au-dessus dans la chaîne,
// soi-même, admin global — ou son approbateur désigné : on doit pouvoir
// VOIR les demandes qu'on doit décider, même hors chaîne N+1)
export function canSee(viewer, employee, roster, config = DEFAULT_CONFIG) {
  if (!viewer) return false
  if (normName(viewer) === normName(employee)) return true
  if (isGlobalAdmin(viewer, config)) return true
  const v = normName(viewer)
  if (chainOf(employee, roster).some(n => normName(n) === v)) return true
  return canDecide(viewer, employee, roster, config)
}

// Tout le sous-arbre de `name` : les personnes dont la chaîne le contient.
export function subtreeOf(name, roster, config = DEFAULT_CONFIG) {
  if (isGlobalAdmin(name, config)) return roster.map(r => r.name)
  const n = normName(name)
  return roster
    .filter(r => chainOf(r.name, roster).some(s => normName(s) === n))
    .map(r => r.name)
}

// Qui peut approuver/refuser les demandes de `employee` :
// 1. son superviseur RH désigné (destinataire exclusif voulu)
// 2. à défaut (transition) : managers du pôle (organigramme) + délégués
// 3. toujours : les admins globaux — jamais soi-même.
export function approversOf(employee, roster, config = DEFAULT_CONFIG) {
  const row = findByName(roster, employee)
  let base = []
  if (row?.rhSupervisor) {
    base = [row.rhSupervisor]
  } else {
    const team = row?.team
    const orgManagers = roster.filter(r => r.manager && r.team === team).map(r => r.name)
    const extras = (team && (config.extraApprovers || {})[team]) || []
    base = [...orgManagers, ...extras]
  }
  const all = [...new Set([...base, ...(config.globalAdmins || [])].map(normName))]
  return all.filter(n => n !== normName(employee))
}

export function canDecide(actor, employee, roster, config = DEFAULT_CONFIG) {
  if (!actor || normName(actor) === normName(employee)) return false
  return approversOf(employee, roster, config).includes(normName(actor))
}

// `name` a-t-il un rôle d'encadrement ? (sous-arbre non vide, superviseur RH
// de quelqu'un, manager organigramme, délégué, ou admin global)
export function isApprover(name, roster, config = DEFAULT_CONFIG) {
  if (isGlobalAdmin(name, config)) return true
  const n = normName(name)
  if (roster.some(r => r.rhSupervisor && normName(r.rhSupervisor) === n)) return true
  if (subtreeOf(name, roster, config).length > 0) return true
  if (roster.some(r => r.manager && normName(r.name) === n)) return true
  return Object.values(config.extraApprovers || {}).some(list => list.some(a => normName(a) === n))
}

// Statut initial d'une nouvelle entrée :
// - type déclaré (arrêt maladie)                  → approved (déclaration)
// - saisie PAR un approbateur POUR quelqu'un      → approved (validation implicite)
// - demandeur = admin global                      → approved
// - au moins un approbateur possible              → pending
// - sinon                                         → approved (historique)
export function initialStatus({ type, employee, submittedBy }, roster, config = DEFAULT_CONFIG) {
  if (DECLARED_TYPES.includes(type)) return 'approved'
  const by = submittedBy || employee
  if (normName(by) !== normName(employee) && canDecide(by, employee, roster, config)) return 'approved'
  if (normName(by) === normName(employee) && isGlobalAdmin(employee, config)) return 'approved'
  if (approversOf(employee, roster, config).length > 0) return 'pending'
  return 'approved'
}

// Nombre de jours calendaires d'une demande, bornes incluses (2026-01-01 → 2026-01-01 = 1).
export function leaveDayCount(startDate, endDate) {
  if (!startDate || !endDate) return 0
  const a = Date.parse(`${startDate}T00:00:00Z`)
  const b = Date.parse(`${endDate}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0
  return Math.round((b - a) / 86400000) + 1
}

// "Demande spéciale" = congé (non déclaré) de plus de MAX_STANDARD_LEAVE_DAYS jours.
// Elle ne peut être validée que par un admin global (direction), pas par le superviseur RH.
export function isSpecialRequest({ startDate, endDate, type } = {}) {
  if (DECLARED_TYPES.includes(type)) return false
  return leaveDayCount(startDate, endDate) > MAX_STANDARD_LEAVE_DAYS
}

// Qui peut décider CETTE demande : pour une demande spéciale, uniquement les admins
// globaux ; sinon la règle normale (superviseur RH désigné / managers / délégués / admins).
export function canDecideLeave(actor, leave, roster, config = DEFAULT_CONFIG) {
  if (!actor || !leave) return false
  if (isSpecialRequest(leave)) {
    return isGlobalAdmin(actor, config) && normName(actor) !== normName(leave.employee)
  }
  return canDecide(actor, leave.employee, roster, config)
}

// ---- Remplaçants (organigramme partagé rh_org) ----
// Le roster porte `replacements` : qui peut remplacer la personne. Règle :
// une personne et son remplaçant ne peuvent pas être ABSENTS en même temps.
// Le télétravail n'est pas une absence (la personne travaille).
export const ABSENCE_TYPES = ['conge_paye', 'conge_sans_solde', 'arret_maladie']

// Binômes de remplacement de `employee`, DANS LES DEUX SENS : ses remplaçants
// désignés + les personnes qu'il/elle remplace (le lien protège les deux).
export function replacementPartners(employee, roster) {
  const n = normName(employee)
  const row = findByName(roster, employee)
  const direct = row?.replacements || []
  const reverse = roster
    .filter(r => (r.replacements || []).some(x => normName(x) === n))
    .map(r => r.name)
  const seen = new Set()
  const out = []
  for (const p of [...direct, ...reverse]) {
    const k = normName(p)
    if (k !== n && !seen.has(k)) { seen.add(k); out.push(p) }
  }
  return out
}

// Absences (non rejetées) des binômes de remplacement qui chevauchent la
// demande. `allLeaves` : lignes complètes côté serveur ; côté client les
// silhouettes ont type=null → comptées comme absence (prudence, le serveur
// tranche avec les vrais types).
export function replacementConflicts(leave, roster, allLeaves) {
  if (!leave || !ABSENCE_TYPES.includes(leave.type)) return []
  const partners = replacementPartners(leave.employee, roster)
  if (partners.length === 0) return []
  const pset = new Set(partners.map(normName))
  return (allLeaves || []).filter(l =>
    l.status !== 'rejected' &&
    ABSENCE_TYPES.includes(l.type ?? 'conge_paye') &&
    pset.has(normName(l.employee)) &&
    leave.startDate <= l.endDate && l.startDate <= leave.endDate
  )
}
