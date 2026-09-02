import { describe, it, expect } from 'vitest'
import { clippedDayCount, payrollSummary, payrollCsv, PAYROLL_TYPES } from '../src/payroll.js'

const ROSTER = [
  { name: 'Eden KTORZA', team: 'Customer Success', email: 'eden@certideal.com' },
  { name: 'Lucas DOSSO', team: 'Marketing', email: 'lucas@certideal.com' },
]

describe('clippedDayCount', () => {
  it('compte les jours entièrement dans la période', () => {
    expect(clippedDayCount('2026-03-05', '2026-03-10', '2026-03-01', '2026-03-31')).toBe(6)
  })
  it('rogne une demande à cheval sur deux mois', () => {
    expect(clippedDayCount('2026-02-25', '2026-03-05', '2026-03-01', '2026-03-31')).toBe(5) // 1..5 mars
    expect(clippedDayCount('2026-02-25', '2026-03-05', '2026-02-01', '2026-02-28')).toBe(4) // 25..28 fév
  })
  it('demande hors période → 0', () => {
    expect(clippedDayCount('2026-01-01', '2026-01-05', '2026-03-01', '2026-03-31')).toBe(0)
  })
})

describe('payrollSummary', () => {
  const base = { status: 'approved' }
  it('agrège par salarié et par type, en jours', () => {
    const leaves = [
      { ...base, employee: 'Eden KTORZA', type: 'conge_paye', startDate: '2026-03-01', endDate: '2026-03-05' },
      { ...base, employee: 'Eden KTORZA', type: 'conge_paye', startDate: '2026-03-10', endDate: '2026-03-10' },
      { ...base, employee: 'Eden KTORZA', type: 'arret_maladie', startDate: '2026-03-15', endDate: '2026-03-16' },
    ]
    const [row] = payrollSummary(leaves, ROSTER, '2026-03-01', '2026-03-31')
    expect(row.employee).toBe('Eden KTORZA')
    expect(row.email).toBe('eden@certideal.com')
    expect(row.conge_paye).toBe(6) // 5 + 1
    expect(row.arret_maladie).toBe(2)
    expect(row.conge_sans_solde).toBe(0)
  })

  it('ignore les demandes non approuvées', () => {
    const leaves = [{ ...base, status: 'pending', employee: 'Eden KTORZA', type: 'conge_paye', startDate: '2026-03-01', endDate: '2026-03-05' }]
    expect(payrollSummary(leaves, ROSTER, '2026-03-01', '2026-03-31')).toEqual([])
  })

  it('ignore le télétravail (pas une absence payante)', () => {
    const leaves = [{ ...base, employee: 'Eden KTORZA', type: 'teletravail', startDate: '2026-03-01', endDate: '2026-03-05' }]
    expect(payrollSummary(leaves, ROSTER, '2026-03-01', '2026-03-31')).toEqual([])
  })

  it('ignore une demande entièrement hors période', () => {
    const leaves = [{ ...base, employee: 'Eden KTORZA', type: 'conge_paye', startDate: '2026-01-01', endDate: '2026-01-05' }]
    expect(payrollSummary(leaves, ROSTER, '2026-03-01', '2026-03-31')).toEqual([])
  })

  it('PAYROLL_TYPES exclut le télétravail', () => {
    expect(PAYROLL_TYPES).toEqual(['conge_paye', 'conge_sans_solde', 'arret_maladie'])
  })

  it('salarié absent du roster : ligne quand même, nom brut, email/équipe vides', () => {
    const leaves = [{ ...base, employee: 'Fantome INCONNU', type: 'conge_paye', startDate: '2026-03-01', endDate: '2026-03-02' }]
    const [row] = payrollSummary(leaves, ROSTER, '2026-03-01', '2026-03-31')
    expect(row.employee).toBe('Fantome INCONNU')
    expect(row.email).toBe('')
    expect(row.team).toBe('')
  })

  it('trié par nom', () => {
    const leaves = [
      { ...base, employee: 'Lucas DOSSO', type: 'conge_paye', startDate: '2026-03-01', endDate: '2026-03-01' },
      { ...base, employee: 'Eden KTORZA', type: 'conge_paye', startDate: '2026-03-01', endDate: '2026-03-01' },
    ]
    const rows = payrollSummary(leaves, ROSTER, '2026-03-01', '2026-03-31')
    expect(rows.map(r => r.employee)).toEqual(['Eden KTORZA', 'Lucas DOSSO'])
  })
})

describe('payrollCsv', () => {
  it('en-tête + une ligne par salarié, séparateur ";"', () => {
    const csv = payrollCsv([{ employee: 'Eden KTORZA', email: 'eden@certideal.com', team: 'Customer Success', conge_paye: 6, conge_sans_solde: 0, arret_maladie: 2 }])
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe('Nom;Email;Équipe;Congé payé (j);Congé sans solde (j);Arrêt maladie (j)')
    expect(lines[1]).toBe('Eden KTORZA;eden@certideal.com;Customer Success;6;0;2')
  })

  it('échappe les champs contenant le séparateur ou des guillemets', () => {
    const csv = payrollCsv([{ employee: 'Nom; "Surnom"', email: '', team: '', conge_paye: 1, conge_sans_solde: 0, arret_maladie: 0 }])
    expect(csv).toContain('"Nom; ""Surnom"""')
  })

  it('liste vide → en-tête seul', () => {
    const csv = payrollCsv([])
    expect(csv.trim().split('\r\n')).toHaveLength(1)
  })
})
