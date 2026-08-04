// Règles du workflow d'approbation — fonctions pures, testables.
//
// Le personnel ET l'organigramme viennent de RH Compliance :
//   roster = lignes { name, team, manager, ... } (voir api/roster.js)
//   - team    = pôle de l'organigramme
//   - manager = true si la personne manage son pôle (détecté depuis le poste)
// La config (src/employees.js) n'apporte que des ajustements :
//   EXTRA_APPROVERS[pôle] = approbateurs supplémentaires
//   GLOBAL_SUPER_ADMINS   = peuvent tout approuver
//
// Chaque fonction accepte une config optionnelle pour les tests ;
// par défaut, la vraie configuration de l'app.

import { EXTRA_APPROVERS, GLOBAL_SUPER_ADMINS } from './employees.js'
import { DECLARED_TYPES } from './constants.js'
import { normName, findByName } from './utils/names.js'

const DEFAULT_CONFIG = { extraApprovers: EXTRA_APPROVERS, globalAdmins: GLOBAL_SUPER_ADMINS }

// L'équipe (pôle) d'une personne, via le roster.
export function teamOf(name, roster) {
  return findByName(roster, name)?.team || null
}

// Qui peut approuver/refuser les demandes de `employee` :
// managers de SON pôle (organigramme) + approbateurs supplémentaires du pôle
// + admins globaux — sauf lui-même.
export function approversOf(employee, roster, config = DEFAULT_CONFIG) {
  const team = teamOf(employee, roster)
  const orgManagers = roster
    .filter(r => r.manager && r.team === team)
    .map(r => r.name)
  const extras = (team && config.extraApprovers[team]) || []
  const all = [...new Set([...orgManagers, ...extras, ...config.globalAdmins].map(normName))]
  return all.filter(n => n !== normName(employee))
}

// `actor` a-t-il le droit de décider la demande de `employee` ?
export function canDecide(actor, employee, roster, config = DEFAULT_CONFIG) {
  if (!actor || normName(actor) === normName(employee)) return false
  return approversOf(employee, roster, config).includes(normName(actor))
}

// Pôles gérés par `name` : '*' pour un admin global, sinon liste de pôles
// (son pôle s'il en est manager dans l'organigramme + pôles où il est
// approbateur supplémentaire).
export function managedTeams(name, roster, config = DEFAULT_CONFIG) {
  const n = normName(name)
  if (config.globalAdmins.some(a => normName(a) === n)) return '*'
  const own = roster
    .filter(r => r.manager && normName(r.name) === n)
    .map(r => r.team)
  const extra = Object.entries(config.extraApprovers)
    .filter(([, list]) => list.some(a => normName(a) === n))
    .map(([team]) => team)
  return [...new Set([...own, ...extra])]
}

// `name` est-il approbateur d'au moins un pôle (ou admin global) ?
export function isApprover(name, roster, config = DEFAULT_CONFIG) {
  const t = managedTeams(name, roster, config)
  return t === '*' || t.length > 0
}

// Statut initial d'une nouvelle entrée :
// - type déclaré (arrêt maladie)                  → approved (déclaration immédiate)
// - saisie PAR un approbateur POUR quelqu'un      → approved (validation implicite)
// - demandeur = admin global (personne au-dessus) → approved
// - au moins un approbateur possible              → pending (workflow manager)
// - sinon (personne pour approuver)               → approved (comportement historique)
export function initialStatus({ type, employee, submittedBy }, roster, config = DEFAULT_CONFIG) {
  if (DECLARED_TYPES.includes(type)) return 'approved'
  const by = submittedBy || employee
  if (normName(by) !== normName(employee) && canDecide(by, employee, roster, config)) return 'approved'
  if (normName(by) === normName(employee) &&
      config.globalAdmins.some(a => normName(a) === normName(employee))) return 'approved'
  if (approversOf(employee, roster, config).length > 0) return 'pending'
  return 'approved'
}
