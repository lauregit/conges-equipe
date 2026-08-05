import { describe, it, expect } from 'vitest'
import handler from '../api/admin.js'

// Chaîne : Eden -> superviseur/validateur Vithusa. Lucas manage Marketing.
const ROSTER = [
  { id: 1, name: 'Vithusa VASIDDAN', team: 'Customer Success', manager: false, supervisor: null, rhSupervisor: null, replacements: [] },
  { id: 2, name: 'Eden KTORZA', team: 'Customer Success', manager: false, supervisor: 'Vithusa VASIDDAN', rhSupervisor: 'Vithusa VASIDDAN', replacements: [] },
  { id: 3, name: 'Lucas DOSSO', team: 'Marketing', manager: true, supervisor: null, rhSupervisor: null, replacements: [] },
  { id: 4, name: 'Salvatore MACRI', team: 'Marketing', manager: false, supervisor: 'Lucas DOSSO', rhSupervisor: 'Lucas DOSSO', replacements: [] },
]
const CONFIG = { extraApprovers: {}, globalAdmins: ['Laure COHEN', 'Yoann VALENSI'] }

function makeSql(profiles = {}) {
  const sql = async (query, params = []) => {
    sql.calls.push({ query, params })
    const q = query.replace(/\s+/g, ' ')
    if (/SELECT name, status FROM conges_profiles WHERE uid/i.test(q)) {
      const p = profiles[params[0]]
      return p ? [p] : []
    }
    if (/FROM conges_profiles ORDER BY/i.test(q)) return [{ uid: 'u9', name: 'X Y', email: 'x@y.fr', status: 'pending' }]
    if (/UPDATE conges_profiles|DELETE FROM conges_profiles/i.test(q)) return []
    if (/conges_settings/i.test(q)) return [{ value: JSON.stringify(CONFIG) }]
    return []
  }
  sql.calls = []
  return sql
}

function mockRes() {
  return {
    statusCode: 0, body: undefined, headers: {},
    setHeader(k, v) { this.headers[k] = v },
    status(c) { this.statusCode = c; return this },
    json(o) { this.body = o; return this },
    end() { return this },
  }
}

const saves = []
async function call(req, as) {
  const res = mockRes()
  const sql = makeSql({ 'uid-1': { name: as, status: 'approved' } })
  await handler(
    { headers: { authorization: 'Bearer x' }, ...req },
    res,
    {
      sql, roster: ROSTER, config: CONFIG,
      verify: async () => ({ uid: 'uid-1', email: 'someone@certideal.com' }),
      saveOrgHierarchy: async (...a) => { saves.push(['hier', ...a]) },
      saveOrgReplacements: async (...a) => { saves.push(['reps', ...a]) },
      saveOrgTeamOverride: async (...a) => { saves.push(['team', ...a]) },
    }
  )
  return res
}

describe('accès à /api/admin', () => {
  it('un simple employé (non manager) → 403', async () => {
    const res = await call({ method: 'GET' }, 'Eden KTORZA')
    expect(res.statusCode).toBe(403)
  })
  it('un manager accède, mais sans les comptes (bindings vides)', async () => {
    const res = await call({ method: 'GET' }, 'Vithusa VASIDDAN')
    expect(res.statusCode).toBe(200)
    expect(res.body.bindings).toEqual([])
  })
  it('un admin global voit les comptes', async () => {
    const res = await call({ method: 'GET' }, 'Laure COHEN')
    expect(res.statusCode).toBe(200)
    expect(res.body.bindings.length).toBe(1)
  })
})

describe('périmètre des managers', () => {
  it('Vithusa règle le pôle d’affichage d’Eden (son N-1) → 200', async () => {
    const res = await call({ method: 'POST', body: { action: 'set-team-override', employee: 'Eden KTORZA', teamOverride: 'SAV — France' } }, 'Vithusa VASIDDAN')
    expect(res.statusCode).toBe(200)
    expect(saves.some(s => s[0] === 'team' && s[1] === 2 && s[2] === 'SAV — France')).toBe(true)
  })
  it('Vithusa hors de son périmètre (Salvatore) → 403', async () => {
    const res = await call({ method: 'POST', body: { action: 'set-team-override', employee: 'Salvatore MACRI', teamOverride: 'X' } }, 'Vithusa VASIDDAN')
    expect(res.statusCode).toBe(403)
  })
  it('un manager ne peut pas s’auto-modifier → 403', async () => {
    const res = await call({ method: 'POST', body: { action: 'set-hierarchy', employee: 'Vithusa VASIDDAN', supervisor: '', rhSupervisor: '' } }, 'Vithusa VASIDDAN')
    expect(res.statusCode).toBe(403)
  })
  it('un manager ne touche ni comptes ni config → 403', async () => {
    expect((await call({ method: 'POST', body: { action: 'approve-binding', uid: 'u9' } }, 'Vithusa VASIDDAN')).statusCode).toBe(403)
    expect((await call({ method: 'POST', body: { action: 'save-config', config: CONFIG } }, 'Vithusa VASIDDAN')).statusCode).toBe(403)
  })
  it('un admin global agit partout, y compris sur un manager', async () => {
    const res = await call({ method: 'POST', body: { action: 'set-hierarchy', employee: 'Lucas DOSSO', supervisor: '', rhSupervisor: 'Vithusa VASIDDAN' } }, 'Yoann VALENSI')
    expect(res.statusCode).toBe(200)
  })
})
