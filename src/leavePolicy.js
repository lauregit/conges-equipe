// Règles du workflow — fonctions pures, testables.
//
// Le roster (via /api/roster) fusionne :
//   - RH Compliance : { name, team, manager, email, ... }
//   - la CHAÎNE DE COMMANDEMENT (admin, table conges_hierarchy) :
//       supervisor    = N+1 (remonte jusqu'à 5 niveaux)
//       rhSupervisor  = superviseur RH désigné — SEUL destinataire des
//                       demandes de congé de la personne
//   - la config (DB, éditable en Admin) : { globalAdmins, extraApprovers }
//
// Visibilité : chacun voit les personnes EN DESSOUS de lui dans la chaîne
// (son sous-arbre) ; les admins globaux voient tout.
// Approbation : superviseur RH désigné → sinon (transition) les managers du
// pôle (organigramme) et approbateurs délégués → plus les admins globaux.

import { EXTRA_APPROVERS, GLOBAL_SUPER_ADMINS } from './employees.js'
import { DECLARED_TYPES } from './constants.js'
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
// soi-même, ou admin global)
export function canSee(viewer, employee, roster, config = DEFAULT_CONFIG) {
  if (!viewer) return false
  if (normName(viewer) === normName(employee)) return true
  if (isGlobalAdmin(viewer, config)) return true
  const v = normName(viewer)
  return chainOf(employee, roster).some(n => normName(n) === v)
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
