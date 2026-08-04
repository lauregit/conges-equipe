import { describe, it, expect } from 'vitest'
import { approversOf, canDecide, isApprover, managedTeams, initialStatus, teamOf } from '../src/leavePolicy.js'
import { normName, sameName, findByName } from '../src/utils/names.js'

// Roster fixture façon /api/roster (RH Compliance) :
// team = pôle de l'organigramme, manager = détecté depuis le poste.
const ROSTER = [
  { name: 'Laure COHEN', team: 'Marketing', manager: false },
  { name: 'Lucas DOSSO', team: 'Marketing', manager: true },   // HEAD OF GROWTH
  { name: 'Salvatore MACRI', team: 'Marketing', manager: false },
  { name: 'Andrea LEVY', team: 'Customer Success', manager: true }, // RESPONSABLE CLIENTS
  { name: 'Eden KTORZA', team: 'Customer Success', manager: false }, // KEY ACCOUNT MANAGER ≠ manager
  { name: 'Vithusa VASIDDAN', team: 'Customer Success', manager: false }, // approbatrice déléguée
  { name: 'Christophe PROT', team: 'Tech', manager: true },    // CTO
  { name: 'Claire HUANG', team: 'Tech', manager: false },
  { name: 'Alexia OSMANI', team: 'Logistique', manager: true }, // MANAGER EXPE
  { name: 'Abba ALI MOUSSA', team: 'Logistique', manager: false },
  { name: 'Hanna BOICHUK', team: 'Ménage', manager: false },   // pôle sans manager
]

const CONFIG = {
  extraApprovers: { 'Customer Success': ['Vithusa VASIDDAN'] },
  globalAdmins: ['Laure COHEN', 'Yoann VALENSI'],
}

describe('names utils', () => {
  it('normalise casse, accents et espaces', () => {
    expect(normName('  Clémentine   PITHON ')).toBe('CLEMENTINE PITHON')
    expect(sameName('LUCAS DOSSO', 'Lucas Dosso')).toBe(true)
    expect(sameName('Lucas DOSSO', 'Lucas DOSSA')).toBe(false)
  })
  it('findByName retrouve une ligne peu importe la casse', () => {
    expect(findByName(ROSTER, 'lucas dosso')?.team).toBe('Marketing')
    expect(findByName(ROSTER, 'Inconnu X')).toBe(null)
  })
})

describe('teamOf / approversOf', () => {
  it('retrouve le pôle organigramme d’une personne', () => {
    expect(teamOf('Claire HUANG', ROSTER)).toBe('Tech')
    expect(teamOf('Personne INCONNUE', ROSTER)).toBe(null)
  })

  it('approbateurs = managers du pôle (organigramme) + délégués + admins globaux, sans soi-même', () => {
    expect(approversOf('Salvatore MACRI', ROSTER, CONFIG).sort()).toEqual(
      ['LAURE COHEN', 'LUCAS DOSSO', 'YOANN VALENSI'].sort()
    )
    // délégué via EXTRA_APPROVERS
    expect(approversOf('Eden KTORZA', ROSTER, CONFIG)).toContain('VITHUSA VASIDDAN')
    // le manager est exclu de SES propres approbateurs
    expect(approversOf('Lucas DOSSO', ROSTER, CONFIG)).not.toContain('LUCAS DOSSO')
    // pôle sans manager : il reste les admins globaux
    expect(approversOf('Hanna BOICHUK', ROSTER, CONFIG).sort()).toEqual(
      ['LAURE COHEN', 'YOANN VALENSI'].sort()
    )
  })
})

describe('canDecide', () => {
  it('le manager du pôle peut décider', () => {
    expect(canDecide('Lucas DOSSO', 'Salvatore MACRI', ROSTER, CONFIG)).toBe(true)
    expect(canDecide('Alexia OSMANI', 'Abba ALI MOUSSA', ROSTER, CONFIG)).toBe(true)
  })
  it('un approbateur délégué (EXTRA_APPROVERS) peut décider', () => {
    expect(canDecide('Vithusa VASIDDAN', 'Eden KTORZA', ROSTER, CONFIG)).toBe(true)
  })
  it('un manager d’un AUTRE pôle ne peut pas', () => {
    expect(canDecide('Christophe PROT', 'Salvatore MACRI', ROSTER, CONFIG)).toBe(false)
  })
  it('personne ne décide sa propre demande', () => {
    expect(canDecide('Lucas DOSSO', 'Lucas DOSSO', ROSTER, CONFIG)).toBe(false)
    expect(canDecide('Laure COHEN', 'Laure COHEN', ROSTER, CONFIG)).toBe(false)
  })
  it('un admin global décide pour tous les pôles', () => {
    expect(canDecide('Laure COHEN', 'Claire HUANG', ROSTER, CONFIG)).toBe(true)
    expect(canDecide('Yoann VALENSI', 'Hanna BOICHUK', ROSTER, CONFIG)).toBe(true)
  })
  it('un simple employé ne décide rien', () => {
    expect(canDecide('Eden KTORZA', 'Claire HUANG', ROSTER, CONFIG)).toBe(false)
  })
  it('comparaison de noms insensible à la casse', () => {
    expect(canDecide('lucas dosso', 'SALVATORE MACRI', ROSTER, CONFIG)).toBe(true)
  })
})

describe('isApprover / managedTeams', () => {
  it('détecte managers organigramme, délégués et admins globaux', () => {
    expect(isApprover('Lucas DOSSO', ROSTER, CONFIG)).toBe(true)
    expect(isApprover('Vithusa VASIDDAN', ROSTER, CONFIG)).toBe(true)
    expect(isApprover('Yoann VALENSI', ROSTER, CONFIG)).toBe(true)
    expect(isApprover('Eden KTORZA', ROSTER, CONFIG)).toBe(false)
  })
  it('managedTeams : pôles gérés, "*" pour un admin global', () => {
    expect(managedTeams('Alexia OSMANI', ROSTER, CONFIG)).toEqual(['Logistique'])
    expect(managedTeams('Vithusa VASIDDAN', ROSTER, CONFIG)).toEqual(['Customer Success'])
    expect(managedTeams('Laure COHEN', ROSTER, CONFIG)).toBe('*')
    expect(managedTeams('Eden KTORZA', ROSTER, CONFIG)).toEqual([])
  })
})

describe('initialStatus — cœur du workflow', () => {
  const st = (o) => initialStatus(o, ROSTER, CONFIG)

  it('une demande normale dans un pôle avec manager → pending', () => {
    expect(st({ type: 'conge_paye', employee: 'Salvatore MACRI' })).toBe('pending')
    expect(st({ type: 'teletravail', employee: 'Claire HUANG', submittedBy: 'Claire HUANG' })).toBe('pending')
  })

  it('un arrêt maladie est déclaré immédiatement → approved', () => {
    expect(st({ type: 'arret_maladie', employee: 'Salvatore MACRI' })).toBe('approved')
  })

  it('une saisie PAR un approbateur POUR un membre → approved (validation implicite)', () => {
    expect(st({ type: 'conge_paye', employee: 'Salvatore MACRI', submittedBy: 'Lucas DOSSO' })).toBe('approved')
    expect(st({ type: 'conge_paye', employee: 'Claire HUANG', submittedBy: 'Laure COHEN' })).toBe('approved')
  })

  it('une saisie par un NON-approbateur pour quelqu’un ne vaut pas validation', () => {
    expect(st({ type: 'conge_paye', employee: 'Salvatore MACRI', submittedBy: 'Eden KTORZA' })).toBe('pending')
  })

  it('la demande d’un manager pour lui-même → pending (un autre doit valider)', () => {
    expect(st({ type: 'conge_paye', employee: 'Lucas DOSSO', submittedBy: 'Lucas DOSSO' })).toBe('pending')
  })

  it('la demande d’un admin global pour lui-même → approved (personne au-dessus)', () => {
    expect(st({ type: 'conge_paye', employee: 'Laure COHEN', submittedBy: 'Laure COHEN' })).toBe('approved')
  })

  it('pôle sans manager → pending quand même (les admins globaux valident)', () => {
    expect(st({ type: 'conge_paye', employee: 'Hanna BOICHUK' })).toBe('pending')
  })

  it('sans AUCUN approbateur possible → approved (comportement historique)', () => {
    const none = { extraApprovers: {}, globalAdmins: [] }
    const soloRoster = [{ name: 'Hanna BOICHUK', team: 'Ménage', manager: false }]
    expect(initialStatus({ type: 'conge_paye', employee: 'Hanna BOICHUK' }, soloRoster, none)).toBe('approved')
  })
})
