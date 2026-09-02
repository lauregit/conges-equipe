// Export "variables de paie" — fonctions pures, testables (comme
// leavePolicy.js). Agrège, par salarié et sur une période donnée, les
// jours de congé APPROUVÉS qui ont un impact paie : congé payé, congé sans
// solde, arrêt maladie. Le télétravail n'en fait pas partie (pas une
// absence — voir leavePolicy.js).

import { leaveDayCount } from './leavePolicy.js'
import { findByName, normName } from './utils/names.js'

export const PAYROLL_TYPES = ['conge_paye', 'conge_sans_solde', 'arret_maladie']

const COLUMN_LABEL = {
  conge_paye: 'Congé payé (j)',
  conge_sans_solde: 'Congé sans solde (j)',
  arret_maladie: 'Arrêt maladie (j)',
}

// Nombre de jours d'une demande qui tombent DANS la période [periodFrom,
// periodTo] (bornes incluses) — une demande à cheval sur deux mois ne
// compte que les jours du mois demandé. Comparaison lexicographique valide
// car les dates sont au format ISO 'YYYY-MM-DD'.
export function clippedDayCount(startDate, endDate, periodFrom, periodTo) {
  const s = startDate < periodFrom ? periodFrom : startDate
  const e = endDate > periodTo ? periodTo : endDate
  if (s > e) return 0
  return leaveDayCount(s, e)
}

// `leaves` : lignes complètes (status/type/startDate/endDate/employee).
// Retourne une ligne par salarié ayant au moins un jour dans la période,
// triée par nom.
export function payrollSummary(leaves, roster, periodFrom, periodTo) {
  const rows = new Map()
  for (const l of leaves || []) {
    if (l.status !== 'approved') continue
    if (!PAYROLL_TYPES.includes(l.type)) continue
    const days = clippedDayCount(l.startDate, l.endDate, periodFrom, periodTo)
    if (days <= 0) continue
    const key = normName(l.employee)
    if (!rows.has(key)) {
      const row = findByName(roster, l.employee)
      rows.set(key, {
        employee: row?.name || l.employee,
        email: row?.email || '',
        team: row?.team || '',
        conge_paye: 0,
        conge_sans_solde: 0,
        arret_maladie: 0,
      })
    }
    rows.get(key)[l.type] += days
  }
  return [...rows.values()].sort((a, b) => a.employee.localeCompare(b.employee))
}

function csvCell(v) {
  const s = String(v ?? '')
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// CSV ';' (Excel FR) — une ligne par salarié, colonnes fixes.
export function payrollCsv(rows) {
  const header = ['Nom', 'Email', 'Équipe', ...PAYROLL_TYPES.map(t => COLUMN_LABEL[t])]
  const lines = [header.map(csvCell).join(';')]
  for (const r of rows) {
    lines.push([r.employee, r.email, r.team, ...PAYROLL_TYPES.map(t => r[t])].map(csvCell).join(';'))
  }
  return lines.join('\r\n') + '\r\n'
}
