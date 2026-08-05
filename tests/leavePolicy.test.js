import { describe, it, expect } from 'vitest'
import {
  approversOf, canDecide, isApprover, initialStatus,
  chainOf, subtreeOf, canSee, isGlobalAdmin, MAX_CHAIN,
  leaveDayCount, isSpecialRequest, canDecideLeave,
} from '../src/leavePolicy.js'
import { normName, sameName, findByName } from '../src/utils/names.js'

// Roster fixture : RH (team/manager) + chaîne de commandement
// (supervisor = N+1, rhSupervisor = destinataire des demandes).
// Chaîne : Eden -> Apolline -> Vithusa -> Andrea (3 niveaux au-dessus d'Eden)
const ROSTER = [
  { name: 'Andrea LEVY', team: 'Customer Success', manager: true, supervisor: null, rhSupervisor: null },
  { name: 'Vithusa VASIDDAN', team: 'Customer Success', manager: false, supervisor: 'Andrea LEVY', rhSupervisor: 'Andrea LEVY' },
  { name: 'Apolline SARAGONI', team: 'Customer Success', manager: false, supervisor: 'Vithusa VASIDDAN', rhSupervisor: 'Vithusa VASIDDAN' },
  { name: 'Eden KTORZA', team: 'Customer Success', manager: false, supervisor: 'Apolline SARAGONI', rhSupervisor: 'Vithusa VASIDDAN' },
  // Pôle Marketing : pas de chaîne définie -> repli managers du pôle
  { name: 'Lucas DOSSO', team: 'Marketing', manager: true, supervisor: null, rhSupervisor: null },
  { name: 'Salvatore MACRI', team: 'Marketing', manager: false, supervisor: null, rhSupervisor: null },
  // Ménage : ni chaîne ni manager
  { name: 'Hanna BOICHUK', team: 'Ménage', manager: false, supervisor: null, rhSupervisor: null },
]

const CONFIG = { extraApprovers: {}, globalAdmins: ['Laure COHEN', 'Yoann VALENSI'] }

describe('names utils', () => {
  it('normalise casse, accents et espaces', () => {
    expect(normName('  Clémentine   PITHON ')).toBe('CLEMENTINE PITHON')
    expect(sameName('LUCAS DOSSO', 'Lucas Dosso')).toBe(true)
    expect(findByName(ROSTER, 'eden ktorza')?.team).toBe('Customer Success')
  })
})

describe('chaîne de commandement', () => {
  it('chainOf remonte les N+1 (max 5)', () => {
    expect(chainOf('Eden KTORZA', ROSTER)).toEqual(['Apolline SARAGONI', 'Vithusa VASIDDAN', 'Andrea LEVY'])
    expect(chainOf('Andrea LEVY', ROSTER)).toEqual([])
  })

  it('chainOf résiste aux cycles', () => {
    const cyclic = [
      { name: 'A A', team: 'X', supervisor: 'B B' },
      { name: 'B B', team: 'X', supervisor: 'A A' },
    ]
    expect(chainOf('A A', cyclic).length).toBeLessThanOrEqual(2)
  })

  it('chainOf est plafonnée à 5 niveaux', () => {
    const deep = Array.from({ length: 8 }, (_, i) => ({
      name: `P ${i}`, team: 'X', supervisor: i < 7 ? `P ${i + 1}` : null,
    }))
    expect(chainOf('P 0', deep).length).toBe(MAX_CHAIN)
  })

  it('canSee : au-dessus voit en dessous, pas l’inverse ni les pairs', () => {
    expect(canSee('Andrea LEVY', 'Eden KTORZA', ROSTER, CONFIG)).toBe(true)      // N+3
    expect(canSee('Apolline SARAGONI', 'Eden KTORZA', ROSTER, CONFIG)).toBe(true) // N+1
    expect(canSee('Eden KTORZA', 'Apolline SARAGONI', ROSTER, CONFIG)).toBe(false) // vers le haut : non
    expect(canSee('Eden KTORZA', 'Eden KTORZA', ROSTER, CONFIG)).toBe(true)       // soi-même
    expect(canSee('Salvatore MACRI', 'Eden KTORZA', ROSTER, CONFIG)).toBe(false)  // autre branche
    expect(canSee('Laure COHEN', 'Eden KTORZA', ROSTER, CONFIG)).toBe(true)       // admin global
  })

  it('canSee : le superviseur RH désigné voit son approuvé même HORS chaîne N+1', () => {
    const r = [
      ...ROSTER,
      { name: 'Louise HEYL', team: 'B2B', manager: false, supervisor: null, rhSupervisor: 'Eden KTORZA' },
    ]
    expect(canSee('Eden KTORZA', 'Louise HEYL', r, CONFIG)).toBe(true)   // décideur → voit
    expect(canSee('Louise HEYL', 'Eden KTORZA', r, CONFIG)).toBe(false)  // pas l'inverse
  })

  it('subtreeOf : tout le sous-arbre, tous niveaux', () => {
    expect(subtreeOf('Andrea LEVY', ROSTER, CONFIG).sort()).toEqual(
      ['Apolline SARAGONI', 'Eden KTORZA', 'Vithusa VASIDDAN'].sort()
    )
    expect(subtreeOf('Apolline SARAGONI', ROSTER, CONFIG)).toEqual(['Eden KTORZA'])
    expect(subtreeOf('Eden KTORZA', ROSTER, CONFIG)).toEqual([])
  })
})

describe('approbation — superviseur RH désigné', () => {
  it('la demande va au superviseur RH désigné (+ admins globaux), pas au N+1', () => {
    // Eden : N+1 = Apolline, mais superviseur RH = Vithusa
    const app = approversOf('Eden KTORZA', ROSTER, CONFIG)
    expect(app).toContain(normName('Vithusa VASIDDAN'))
    expect(app).not.toContain(normName('Apolline SARAGONI'))
    expect(app).toContain(normName('Laure COHEN'))
  })

  it('canDecide suit le superviseur RH', () => {
    expect(canDecide('Vithusa VASIDDAN', 'Eden KTORZA', ROSTER, CONFIG)).toBe(true)
    expect(canDecide('Apolline SARAGONI', 'Eden KTORZA', ROSTER, CONFIG)).toBe(false)
    expect(canDecide('Andrea LEVY', 'Eden KTORZA', ROSTER, CONFIG)).toBe(false) // pas le superviseur RH désigné
    expect(canDecide('Yoann VALENSI', 'Eden KTORZA', ROSTER, CONFIG)).toBe(true) // admin global
  })

  it('sans superviseur RH : repli sur les managers du pôle (organigramme)', () => {
    expect(canDecide('Lucas DOSSO', 'Salvatore MACRI', ROSTER, CONFIG)).toBe(true)
    expect(canDecide('Andrea LEVY', 'Salvatore MACRI', ROSTER, CONFIG)).toBe(false)
  })

  it('personne ne décide sa propre demande', () => {
    expect(canDecide('Vithusa VASIDDAN', 'Vithusa VASIDDAN', ROSTER, CONFIG)).toBe(false)
  })

  it('isApprover : superviseur RH, manager organigramme, N+1 avec sous-arbre, admin', () => {
    expect(isApprover('Vithusa VASIDDAN', ROSTER, CONFIG)).toBe(true) // superviseur RH + sous-arbre
    expect(isApprover('Apolline SARAGONI', ROSTER, CONFIG)).toBe(true) // sous-arbre (Eden)
    expect(isApprover('Lucas DOSSO', ROSTER, CONFIG)).toBe(true) // manager organigramme
    expect(isApprover('Eden KTORZA', ROSTER, CONFIG)).toBe(false)
    expect(isApprover('Laure COHEN', ROSTER, CONFIG)).toBe(true)
  })
})

describe('initialStatus', () => {
  const st = (o) => initialStatus(o, ROSTER, CONFIG)

  it('demande avec superviseur RH → pending ; arrêt maladie → approved', () => {
    expect(st({ type: 'conge_paye', employee: 'Eden KTORZA' })).toBe('pending')
    expect(st({ type: 'arret_maladie', employee: 'Eden KTORZA' })).toBe('approved')
  })

  it('saisie PAR le superviseur RH → approved ; par un autre → pending', () => {
    expect(st({ type: 'conge_paye', employee: 'Eden KTORZA', submittedBy: 'Vithusa VASIDDAN' })).toBe('approved')
    expect(st({ type: 'conge_paye', employee: 'Eden KTORZA', submittedBy: 'Apolline SARAGONI' })).toBe('pending')
  })

  it('admin global pour soi → approved ; pôle sans approbateur → pending (admins) ; personne → approved', () => {
    expect(st({ type: 'conge_paye', employee: 'Hanna BOICHUK' })).toBe('pending')
    const none = { extraApprovers: {}, globalAdmins: [] }
    expect(initialStatus({ type: 'conge_paye', employee: 'Hanna BOICHUK' }, ROSTER, none)).toBe('approved')
    expect(isGlobalAdmin('Laure COHEN', CONFIG)).toBe(true)
  })
})

describe('demande spéciale (> 2 semaines)', () => {
  const CFG = { extraApprovers: {}, globalAdmins: ['Laure COHEN', 'Yoann VALENSI'] }
  it('leaveDayCount compte les jours bornes incluses', () => {
    expect(leaveDayCount('2026-03-01', '2026-03-01')).toBe(1)
    expect(leaveDayCount('2026-03-01', '2026-03-14')).toBe(14)
    expect(leaveDayCount('2026-03-01', '2026-03-15')).toBe(15)
    expect(leaveDayCount('2026-03-15', '2026-03-01')).toBe(0) // inversé
    expect(leaveDayCount('', '2026-03-01')).toBe(0)
  })
  it('isSpecialRequest : > 14 jours et type non déclaré', () => {
    expect(isSpecialRequest({ startDate: '2026-03-01', endDate: '2026-03-14', type: 'conge_paye' })).toBe(false)
    expect(isSpecialRequest({ startDate: '2026-03-01', endDate: '2026-03-15', type: 'conge_paye' })).toBe(true)
    expect(isSpecialRequest({ startDate: '2026-03-01', endDate: '2026-03-15', type: 'conge_sans_solde' })).toBe(true)
    // un arrêt maladie (déclaré) n'est jamais "spécial", même long
    expect(isSpecialRequest({ startDate: '2026-03-01', endDate: '2026-04-30', type: 'arret_maladie' })).toBe(false)
  })
  it('canDecideLeave : demande normale = superviseur RH ; spéciale = direction seulement', () => {
    const normal = { employee: 'Vithusa VASIDDAN', startDate: '2026-03-01', endDate: '2026-03-10', type: 'conge_paye' }
    const special = { employee: 'Vithusa VASIDDAN', startDate: '2026-03-01', endDate: '2026-03-20', type: 'conge_paye' }
    // normale : le superviseur RH (Andrea) décide
    expect(canDecideLeave('Andrea LEVY', normal, ROSTER, CFG)).toBe(true)
    // spéciale : le superviseur RH ne peut PLUS décider
    expect(canDecideLeave('Andrea LEVY', special, ROSTER, CFG)).toBe(false)
    // spéciale : seule la direction (admin global) décide
    expect(canDecideLeave('Laure COHEN', special, ROSTER, CFG)).toBe(true)
    // personne ne valide sa propre demande spéciale, même admin
    const selfSpecial = { ...special, employee: 'Laure COHEN' }
    expect(canDecideLeave('Laure COHEN', selfSpecial, ROSTER, CFG)).toBe(false)
  })
})
